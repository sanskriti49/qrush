package com.qrush;

import com.qrush.repository.AllocationRepository;
import com.qrush.service.WaitingRoomService;
import com.qrush.service.FlowRegistry;
import com.qrush.service.ResourceAllocationService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestClient;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end HTTP checks against the real Redis scripts and PostgreSQL ledger.
 * Each test creates its own flow. No production/demo flow is reset or cleared.
 * Run with docker compose up -d, then ./mvnw test.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"qrush.scheduling.enabled=false", "spring.jpa.show-sql=false"})
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ReservationEngineIntegrationTests {
    @LocalServerPort int port;
    @Autowired StringRedisTemplate redis;
    @Autowired AllocationRepository allocations;
    @Autowired WaitingRoomService waitingRoom;
    @Autowired FlowRegistry registry;
    @Autowired ResourceAllocationService resources;
    @Autowired JdbcTemplate jdbc;

    private final List<String> testFlows = new ArrayList<>();
    private RestClient client;
    private String flow;

    @BeforeEach
    void isolatedFlow() {
        client = RestClient.builder().baseUrl("http://127.0.0.1:" + port).build();
        flow = createFlow("slot", 12);
        policy(flow, 12, 12, 5);
        scenario(flow, "OUTAGE");
    }

    @AfterAll
    void removeOnlyTestFixtures() {
        // Remove registry entries first so no future scheduler discovers these fixtures.
        for (String id : testFlows) {
            redis.opsForSet().remove("qrush:flows", id);
            redis.opsForSet().remove("events:active_waiting_rooms", id);
            allocations.deleteAll(allocations.findByPoolId(id));
            jdbc.update("DELETE FROM openings WHERE id = ?", id);
            for (String pattern : List.of("flow:" + id, "flow:" + id + ":*", "event:" + id + ":*", "pool:" + id + ":*")) {
                List<String> keys = new ArrayList<>();
                try (Cursor<String> cursor = redis.scan(ScanOptions.scanOptions().match(pattern).count(100).build())) {
                    cursor.forEachRemaining(keys::add);
                }
                if (!keys.isEmpty()) redis.delete(keys);
            }
        }
    }

    @Test
    void publishedOpeningsSaveDetailsSurviveRegistryRebuildAndRetryCreation() {
        UUID key = UUID.randomUUID();
        Map<String,Object> body = Map.of("name", "Saturday Design Jam", "description", "A practical workshop for curious makers.",
            "capacity", 7, "opensAt", Instant.now().plusSeconds(3600).toString(), "requestId", key.toString());
        Result created = request(HttpMethod.POST, "/api/openings", body);
        assertThat(created.status()).isEqualTo(201);
        String id = created.map().get("id").toString(); testFlows.add(id);
        assertThat(created.map()).containsEntry("capacity", 7).containsEntry("status", "SCHEDULED").containsEntry("available", 7);
        assertThat(created.map().get("registrationPath")).isEqualTo("/#r/"+id);
        assertThat(request(HttpMethod.POST, "/api/openings", body).map().get("id")).isEqualTo(id);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM openings WHERE request_id = ?", Integer.class, key)).isEqualTo(1);
        redis.delete("flow:"+id);
        registry.defaults();
        Result restored = request(HttpMethod.GET, "/api/openings/"+id, null);
        assertThat(restored.map()).containsEntry("name", "Saturday Design Jam").containsEntry("description", body.get("description")).containsEntry("capacity", 7);
        assertThat(units(id)).hasSize(7);
    }

    @Test
    void futureOpeningsCannotBeJoinedOrAdmittedBeforeTheirTime() {
        String id = opening(2, Instant.now().plusSeconds(3600));
        Participant person = session(id);
        assertThat(join(id, person).status()).isEqualTo(409);
        // Even a pre-existing queue entry must not be admitted by a scheduler tick.
        redis.opsForZSet().add(WaitingRoomService.queueKey(id), person.claimantId(), 1);
        tick(id);
        assertThat(status(id, person).map().get("admitted")).isEqualTo(false);
        assertThat(claim("hold", id, person.withAdmission("fake"), "spot-01").status()).isEqualTo(409);
        assertThat(units(id)).allSatisfy(unit -> assertThat(unit.get("status")).isEqualTo("AVAILABLE"));
    }

    @Test
    void openingFieldsAndLocalCreationBoundaryAreValidated() {
        var bad = Map.of("name", "Hi", "description", "short", "capacity", 0, "opensAt", Instant.now().toString());
        assertThat(request(HttpMethod.POST, "/api/openings", bad).status()).isEqualTo(400);
        assertThat(request(HttpMethod.POST, "/api/openings", Map.of("name", "A valid name", "description", "A helpful description.", "capacity", 1001, "opensAt", Instant.now().toString())).status()).isEqualTo(400);
        ResponseEntity<Object> blocked = client.post().uri("/api/openings").header("Origin", "https://untrusted.example")
            .contentType(MediaType.APPLICATION_JSON).body(bad).retrieve().onStatus(code -> code.isError(), (req,res) -> {}).toEntity(Object.class);
        assertThat(blocked.getStatusCode().value()).isEqualTo(403);
    }

    @Test
    void cancellationIsOwnedIdempotentAndAllowsTheNextParticipantToClaim() {
        String id = opening(1, Instant.now());
        Participant alice = admit(id, session(id));
        assertThat(claim("hold", id, alice, "spot-01").status()).isEqualTo(200);
        String booking = claim("confirm", id, alice, "spot-01").map().get("allocationId").toString();
        Participant bob = session(id);
        assertThat(cancel(id, bob, booking).status()).isEqualTo(404);
        assertThat(cancel(id, alice, booking).map().get("status")).isEqualTo("CANCELLED");
        assertThat(cancel(id, alice, booking).status()).isEqualTo(200);
        assertThat(unit(id,"spot-01").get("status")).isEqualTo("AVAILABLE");
        assertThat(request(HttpMethod.GET, "/api/pools/"+id+"/allocation?claimantId="+alice.claimantId()+"&sessionToken="+alice.sessionToken(), null).status()).isEqualTo(204);
        bob = admit(id, bob);
        assertThat(claim("hold", id, bob, "spot-01").status()).isEqualTo(200);
        assertThat(claim("confirm", id, bob, "spot-01").status()).isEqualTo(200);
        // A delayed cancellation retry cannot free the replacement owner's booking.
        assertThat(cancel(id, alice, booking).status()).isEqualTo(200);
        resources.initializePool(id,"spot",1);
        assertThat(unit(id,"spot-01").get("status")).isEqualTo("CONFIRMED");
        assertThat(status(id,alice).map().get("status")).isNotEqualTo("CONFIRMED");
        assertThat(number(status(id,alice).map(),"position")).isZero();
        assertThat(allocations.findByPoolId(id)).hasSize(2);
    }

    @Test
    void aCancelledParticipantCanRebookWhileOldCancellationRetriesLeaveTheirNewHoldAlone() {
        String id = opening(2, Instant.now());
        Participant alice = admit(id,session(id));
        claim("hold",id,alice,"spot-01");
        String old = claim("confirm",id,alice,"spot-01").map().get("allocationId").toString();
        cancel(id,alice,old);
        alice = admit(id,alice);
        assertThat(claim("hold",id,alice,"spot-02").status()).isEqualTo(200);
        assertThat(cancel(id,alice,old).status()).isEqualTo(200);
        assertThat(unit(id,"spot-02").get("status")).isEqualTo("HELD");
        assertThat(claim("confirm",id,alice,"spot-02").status()).isEqualTo(200);
        assertThat(allocations.findByPoolIdAndClaimantId(id,alice.claimantId()).orElseThrow().getUnitId()).isEqualTo("spot-02");
        assertThat(allocations.findByPoolIdAndClaimantIdOrderByConfirmedAtDesc(id,alice.claimantId())).hasSize(2);
    }

    @Test
    void registrationsLookupRecoversHoldsAndHistoryButNeverAnotherParticipantsBooking() {
        String id = opening(3, Instant.now());
        Participant alice = admit(id, session(id));
        claim("hold", id, alice, "spot-01");
        var lookup = Map.of("sessions", List.of(Map.of("flowId",id,"claimantId",alice.claimantId(),"sessionToken",alice.sessionToken())));
        Result held = request(HttpMethod.POST,"/api/registrations/lookup",lookup);
        Map<?,?> row = (Map<?,?>)((List<?>)held.body()).getFirst();
        assertThat(((Map<?,?>)row.get("queue")).get("heldUnitId")).isEqualTo("spot-01");
        String booking = claim("confirm",id,alice,"spot-01").map().get("allocationId").toString();
        cancel(id,alice,booking);
        row = (Map<?,?>)((List<?>)request(HttpMethod.POST,"/api/registrations/lookup",lookup).body()).getFirst();
        assertThat(((Map<?,?>)((List<?>)row.get("history")).getFirst()).get("status")).isEqualTo("CANCELLED");
        Result forged = request(HttpMethod.POST,"/api/registrations/lookup",Map.of("sessions", List.of(Map.of("flowId",id,"claimantId",alice.claimantId(),"sessionToken","wrong"))));
        row = (Map<?,?>)((List<?>)forged.body()).getFirst();
        assertThat(row.get("status")).isEqualTo("SESSION_EXPIRED");
        assertThat(row.containsKey("history")).isFalse();
    }

    @Test
    void cancellationRacingConfirmationRetriesCannotResurrectAnOldBooking() {
        String id = opening(1, Instant.now());
        Participant alice = admit(id, session(id));
        claim("hold",id,alice,"spot-01");
        String booking = claim("confirm",id,alice,"spot-01").map().get("allocationId").toString();
        parallel(List.of(() -> cancel(id,alice,booking), () -> claim("confirm",id,alice,"spot-01"), () -> cancel(id,alice,booking)));
        redis.delete("flow:"+id+":reconcile-gate");
        assertThat(unit(id,"spot-01").get("status")).isEqualTo("AVAILABLE");
        assertThat(allocations.findByPoolIdAndClaimantId(id,alice.claimantId())).isEmpty();
        assertThat(status(id,alice).map().get("status")).isNotEqualTo("CONFIRMED");
    }

    private String opening(int capacity, Instant opensAt) {
        Result result = request(HttpMethod.POST,"/api/openings",Map.of("name","Integration Opening","description","A private test fixture for registration checks.","capacity",capacity,"opensAt",opensAt.toString()));
        assertThat(result.status()).isEqualTo(201);
        String id = result.map().get("id").toString(); testFlows.add(id); return id;
    }

    private Result cancel(String id, Participant person, String booking) {
        return request(HttpMethod.POST,"/api/pools/"+id+"/cancel?sessionToken="+person.sessionToken(),Map.of("claimantId",person.claimantId(),"allocationId",booking));
    }

    @Test
    void duplicateJoinsKeepOnePositionAndArrivalOrder() {
        Participant first = session(flow);
        Participant second = session(flow);
        assertThat(number(join(flow, first).map(), "position")).isEqualTo(1);
        assertThat(number(join(flow, second).map(), "position")).isEqualTo(2);

        List<Result> retries = parallel(16, () -> join(flow, first));
        assertThat(retries).allSatisfy(result -> {
            assertThat(result.status()).isEqualTo(200);
            assertThat(number(result.map(), "position")).isEqualTo(1);
            assertThat(number(result.map(), "totalInQueue")).isEqualTo(2);
        });
        assertThat(number(status(flow, second).map(), "position")).isEqualTo(2);
    }

    @Test
    void participantSessionsCannotBeForgedOrReusedInAnotherFlow() {
        Participant person = session(flow);
        String secondFlow = createFlow("item", 3);
        assertThat(request(HttpMethod.POST, "/api/waiting-room/" + flow + "/join?userId="
            + person.claimantId() + "&sessionToken=wrong", null).status()).isEqualTo(401);
        assertThat(join(secondFlow, person).status()).isEqualTo(401);
        assertThat(join(flow, person).status()).isEqualTo(200);
    }

    @Test
    void validSessionWithoutAdmissionCannotBypassTheWaitingRoom() {
        Participant person = session(flow);
        join(flow, person);
        Result attempted = claim("hold", flow, person.withAdmission("invented-token"), "slot-01");
        assertThat(attempted.status()).isBetween(400, 499);
        assertThat(units(flow)).allSatisfy(unit -> assertThat(unit.get("status")).isEqualTo("AVAILABLE"));
        assertThat(allocations.findByPoolId(flow)).isEmpty();
    }

    @Test
    void admissionTokenCannotBeUsedByAnotherParticipant() {
        Participant owner = admit(flow, session(flow));
        Participant other = session(flow).withAdmission(owner.admissionToken());
        assertThat(claim("hold", flow, other, "slot-01").status()).isBetween(400, 499);
        assertThat(claim("hold", flow, owner, "slot-01").status()).isEqualTo(200);
    }

    @Test
    void concurrentBuyersCompetingForOneUnitProduceOneWinner() {
        List<Participant> people = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            Participant person = session(flow);
            join(flow, person);
            people.add(person);
        }
        scenario(flow, "NORMAL");
        tick(flow);
        List<Callable<Result>> attempts = people.stream().<Callable<Result>>map(person -> () ->
            claim("hold", flow, admitted(flow, person), "slot-01")).toList();
        List<Result> results = parallel(attempts);
        assertThat(results.stream().filter(result -> result.status() == 200).count()).isEqualTo(1);
        assertThat(results.stream().filter(result -> result.status() == 409).count()).isEqualTo(11);
        assertThat(units(flow).stream().filter(unit -> "HELD".equals(unit.get("status"))).count()).isEqualTo(1);
    }

    @Test
    void oneParticipantCannotHoardMultipleResources() {
        Participant person = admit(flow, session(flow));
        assertThat(claim("hold", flow, person, "slot-01").status()).isEqualTo(200);
        assertThat(claim("hold", flow, person, "slot-02").status()).isEqualTo(409);
        assertThat(units(flow).stream().filter(unit -> "HELD".equals(unit.get("status"))).count()).isEqualTo(1);
    }

    @Test
    void unknownResourceCannotBeHeldOrConfirmed() {
        Participant person = admit(flow, session(flow));
        assertThat(claim("hold", flow, person, "slot-999").status()).isBetween(400, 499);
        assertThat(claim("confirm", flow, person, "slot-999").status()).isBetween(400, 499);
        assertThat(allocations.findByPoolId(flow)).isEmpty();
    }

    @Test
    void onlyTheHolderCanReleaseAResource() {
        Participant owner = admit(flow, session(flow));
        Participant stranger = admit(flow, session(flow));
        assertThat(claim("hold", flow, owner, "slot-01").status()).isEqualTo(200);
        assertThat(claim("release", flow, stranger, "slot-01").status()).isBetween(400, 499);
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo("HELD");
        assertThat(claim("release", flow, owner, "slot-01").status()).isEqualTo(200);
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo("AVAILABLE");
        assertThat(claim("hold", flow, stranger, "slot-01").status()).isEqualTo(200);
    }

    @Test
    void simultaneousReleaseAndConfirmationHaveOneConsistentOutcome() {
        Participant person = admit(flow, session(flow));
        assertThat(claim("hold", flow, person, "slot-01").status()).isEqualTo(200);
        List<Result> results = parallel(List.of(
            () -> claim("confirm", flow, person, "slot-01"),
            () -> claim("release", flow, person, "slot-01")));
        assertThat(results.stream().filter(result -> result.status() == 200).count()).isEqualTo(1);
        assertThat(results.stream().filter(result -> result.status() == 409).count()).isEqualTo(1);
        boolean confirmed = results.get(0).status() == 200;
        assertThat(allocations.findByPoolId(flow)).hasSize(confirmed ? 1 : 0);
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo(confirmed ? "CONFIRMED" : "AVAILABLE");
        assertThat(status(flow, person).map().get("admitted")).isEqualTo(false);
    }

    @Test
    void staleReleaseCannotCancelTheSameParticipantsNewReservation() {
        Participant oldJourney = admit(flow, session(flow));
        assertThat(claim("hold", flow, oldJourney, "slot-01").status()).isEqualTo(200);
        assertThat(claim("release", flow, oldJourney, "slot-01").status()).isEqualTo(200);
        Participant currentJourney = admit(flow, oldJourney);
        assertThat(currentJourney.admissionToken()).isNotEqualTo(oldJourney.admissionToken());
        assertThat(claim("hold", flow, currentJourney, "slot-01").status()).isEqualTo(200);
        assertThat(claim("release", flow, oldJourney, "slot-01").status()).isEqualTo(409);
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo("HELD");
        assertThat(status(flow, currentJourney).map().get("admissionToken")).isEqualTo(currentJourney.admissionToken());
        assertThat(claim("release", flow, currentJourney, "slot-01").status()).isEqualTo(200);
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo("AVAILABLE");
    }

    @Test
    void expiredLeaseIsRecycledAndCannotBeConfirmedByItsOldHolder() {
        Participant former = admit(flow, session(flow));
        Participant next = admit(flow, session(flow));
        assertThat(claim("hold", flow, former, "slot-01").status()).isEqualTo(200);
        await(Duration.ofSeconds(8), () -> "AVAILABLE".equals(unit(flow, "slot-01").get("status")));
        assertThat(claim("confirm", flow, former, "slot-01").status()).isBetween(400, 499);
        assertThat(allocations.findByPoolId(flow)).isEmpty();
        // Rejoin/recover may be needed when admission and resource lease expire together.
        next = admit(flow, next);
        assertThat(claim("hold", flow, next, "slot-01").status()).isEqualTo(200);
    }

    @Test
    void simultaneousConfirmationRetriesPersistExactlyOneAllocation() {
        Participant person = admit(flow, session(flow));
        assertThat(claim("hold", flow, person, "slot-01").status()).isEqualTo(200);
        List<Result> results = parallel(12, () -> claim("confirm", flow, person, "slot-01"));
        assertThat(results).allSatisfy(result -> {
            assertThat(result.status()).isEqualTo(200);
            assertThat(result.map().get("success")).isEqualTo(true);
        });
        assertThat(results.stream().map(result -> result.map().get("allocationId")).distinct()).hasSize(1);
        assertThat(allocations.findByPoolId(flow)).hasSize(1);
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo("CONFIRMED");
    }

    @Test
    void confirmationRetrySurvivesConsumedAdmissionAndHoldTokens() {
        Participant person = admit(flow, session(flow));
        claim("hold", flow, person, "slot-01");
        Result first = claim("confirm", flow, person, "slot-01");
        Result repeated = claim("confirm", flow, person, "slot-01");
        assertThat(first.status()).isEqualTo(200);
        assertThat(repeated.status()).isEqualTo(200);
        assertThat(repeated.map().get("allocationId")).isEqualTo(first.map().get("allocationId"));
        assertThat(allocations.findByPoolId(flow)).hasSize(1);
    }

    @Test
    void reinitializingAPoolDoesNotResetHeldOrConfirmedInventory() {
        Participant person = admit(flow, session(flow));
        claim("hold", flow, person, "slot-01");
        assertThat(claim("confirm", flow, person, "slot-01").status()).isEqualTo(200);
        assertThat(request(HttpMethod.POST, "/api/pools/" + flow + "/init?prefix=slot&totalUnits=12", null).status()).isEqualTo(200);
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo("CONFIRMED");
        assertThat(allocations.findByPoolId(flow)).hasSize(1);
        assertThat(request(HttpMethod.POST, "/api/pools/" + flow + "/init?prefix=slot&totalUnits=13", null).status()).isEqualTo(400);
    }

    @Test
    void durableLedgerRepairsAStaleRedisInventoryProjection() {
        Participant first = admit(flow, session(flow));
        claim("hold", flow, first, "slot-01");
        assertThat(claim("confirm", flow, first, "slot-01").status()).isEqualTo(200);
        // Model loss of the cache projection after PostgreSQL has committed.
        // Session credentials, catalog, and other flows remain untouched.
        redis.delete("pool:" + flow + ":units:confirmed");
        redis.opsForSet().add("pool:" + flow + ":units:available", "slot-01");
        assertThat(request(HttpMethod.POST, "/api/pools/" + flow + "/init?prefix=slot&totalUnits=12", null).status()).isEqualTo(200);
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo("CONFIRMED");
        Participant second = admit(flow, session(flow));
        assertThat(claim("hold", flow, second, "slot-01").status()).isEqualTo(409);
        assertThat(allocations.findByPoolId(flow)).hasSize(1);
    }

    @Test
    void interruptedSettlementWithoutADatabaseCommitIsRecoveredSafely() {
        Participant person = admit(flow, session(flow));
        assertThat(claim("hold", flow, person, "slot-01").status()).isEqualTo(200);
        // Execute the real prepare script, then model a process exit before SQL persistence.
        DefaultRedisScript<Long> prepare = new DefaultRedisScript<>();
        prepare.setLocation(new ClassPathResource("scripts/begin_settlement.lua"));
        prepare.setResultType(Long.class);
        Long prepared = redis.execute(prepare, List.of(
            "pool:" + flow + ":hold:slot-01", "pool:" + flow + ":finalizing:slot-01",
            "event:" + flow + ":admitted:" + person.claimantId(), "pool:" + flow + ":owner:" + person.claimantId(),
            "pool:" + flow + ":leases", "pool:" + flow + ":settlements"),
            person.claimantId(), UUID.randomUUID().toString(), person.admissionToken(), "slot-01", String.valueOf(System.currentTimeMillis()));
        assertThat(prepared).isEqualTo(1L);
        assertThat(redis.getExpire("pool:" + flow + ":hold:slot-01")).isEqualTo(-1);
        // Advance only this test's recovery deadline instead of waiting 30 seconds.
        redis.opsForZSet().add("pool:" + flow + ":settlements", "slot-01", 0);
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo("AVAILABLE");
        assertThat(redis.hasKey("pool:" + flow + ":finalizing:slot-01")).isFalse();
        assertThat(allocations.findByPoolId(flow)).isEmpty();
        assertThat(claim("confirm", flow, person, "slot-01").status()).isEqualTo(409);
    }

    @Test
    void outagePausesAdmissionAndConfirmationThenRecoversWithoutLosingTheHold() {
        Participant owner = admit(flow, session(flow));
        assertThat(claim("hold", flow, owner, "slot-01").status()).isEqualTo(200);
        scenario(flow, "OUTAGE");
        Participant waiter = session(flow);
        join(flow, waiter);
        tick(flow);
        assertThat(status(flow, waiter).map().get("admitted")).isEqualTo(false);
        assertThat(claim("confirm", flow, owner, "slot-01").status()).isEqualTo(503);
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo("HELD");
        assertThat(allocations.findByPoolId(flow)).isEmpty();
        scenario(flow, "NORMAL");
        tick(flow);
        assertThat(status(flow, waiter).map().get("admitted")).isEqualTo(true);
        assertThat(claim("confirm", flow, owner, "slot-01").status()).isEqualTo(200);
    }

    @Test
    void concurrentAdmissionProcessorsRespectTheConfiguredCapacity() {
        policy(flow, 3, 12, 30);
        List<Participant> people = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            Participant person = session(flow);
            join(flow, person);
            people.add(person);
        }
        scenario(flow, "NORMAL");
        parallel(12, () -> { waitingRoom.processFlow(flow); return true; });
        long admitted = people.stream().filter(person -> Boolean.TRUE.equals(status(flow, person).map().get("admitted"))).count();
        assertThat(admitted).isEqualTo(3);
        assertThat(people.stream().filter(person -> !Boolean.TRUE.equals(status(flow, person).map().get("admitted"))).count()).isEqualTo(9);
    }

    @Test
    void scarceInventoryAlsoLimitsAdmissionBeforeAResourceIsSelected() {
        String scarceFlow = createFlow("item", 1);
        policy(scarceFlow, 12, 12, 30);
        scenario(scarceFlow, "OUTAGE");
        Participant first = session(scarceFlow);
        Participant next = session(scarceFlow);
        join(scarceFlow, first);
        join(scarceFlow, next);
        scenario(scarceFlow, "NORMAL");
        tick(scarceFlow);
        first = admitted(scarceFlow, first);
        tick(scarceFlow);
        assertThat(status(scarceFlow, next).map().get("admitted")).isEqualTo(false);
        assertThat(claim("hold", scarceFlow, first, "item-01").status()).isEqualTo(200);
        tick(scarceFlow);
        assertThat(status(scarceFlow, next).map().get("admitted")).isEqualTo(false);
        assertThat(claim("release", scarceFlow, first, "item-01").status()).isEqualTo(200);
        tick(scarceFlow);
        assertThat(status(scarceFlow, next).map().get("admitted")).isEqualTo(true);
    }

    @Test
    void leavingAQueueOrCheckoutReleasesCapacityForTheNextParticipant() {
        policy(flow, 1, 12, 30);
        Participant first = admit(flow, session(flow));
        Participant next = session(flow);
        join(flow, next);
        tick(flow);
        assertThat(status(flow, next).map().get("admitted")).isEqualTo(false);
        assertThat(request(HttpMethod.POST, "/api/waiting-room/" + flow + "/leave?" + credentials(first), null).status()).isEqualTo(200);
        tick(flow);
        assertThat(status(flow, next).map().get("admitted")).isEqualTo(true);
    }

    @Test
    void flowPoliciesAndResourceCatalogsRemainIsolated() {
        String secondFlow = createFlow("item", 2);
        policy(secondFlow, 1, 1, 30);
        scenario(secondFlow, "OUTAGE");
        Participant first = admit(flow, session(flow));
        Participant second = session(secondFlow);
        join(secondFlow, second);
        assertThat(claim("hold", flow, first, "slot-01").status()).isEqualTo(200);
        assertThat(units(secondFlow)).hasSize(2).allSatisfy(unit -> assertThat(unit.get("status")).isEqualTo("AVAILABLE"));
        assertThat(status(secondFlow, second).map().get("admitted")).isEqualTo(false);
        assertThat(status(flow, first).map().get("admitted")).isEqualTo(true);
    }

    @Test
    void invalidPoliciesAndUnknownFlowsReturnClientErrors() {
        assertThat(request(HttpMethod.PUT, "/api/flows/" + flow + "/policy", Map.of(
            "maxConcurrent", 0, "admissionRate", 12, "holdSeconds", 5, "adaptive", true)).status()).isEqualTo(400);
        assertThat(request(HttpMethod.PUT, "/api/flows/" + flow + "/policy", Map.of(
            "maxConcurrent", 12, "admissionRate", 12, "holdSeconds", 1, "adaptive", true)).status()).isEqualTo(400);
        assertThat(request(HttpMethod.GET, "/api/flows/unknown-" + UUID.randomUUID(), null).status()).isEqualTo(404);
        assertThat(request(HttpMethod.POST, "/api/flows/" + flow + "/load", Map.of("buyers", 1001)).status()).isEqualTo(400);
        assertThat(request(HttpMethod.POST, "/api/flows/" + flow + "/scenario", Map.of()).status()).isEqualTo(400);
    }

    @Test
    void sseReconnectImmediatelyRestoresTheSameQueuePosition() throws Exception {
        Participant person = session(flow);
        join(flow, person);
        String first = initialSseEvent(flow, person);
        String reconnected = initialSseEvent(flow, person);
        assertThat(first).contains("event:QUEUE_UPDATE", "\"position\":1", "\"status\":\"WAITING\"");
        assertThat(reconnected).contains("event:QUEUE_UPDATE", "\"position\":1", "\"status\":\"WAITING\"");
        assertThat(number(status(flow, person).map(), "totalInQueue")).isEqualTo(1);
    }

    @Test
    void adaptiveAndFixedAdmissionRespondDifferentlyToTheSameSlowdown() {
        List<Participant> adaptivePeople = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            Participant person = session(flow);
            join(flow, person);
            adaptivePeople.add(person);
        }
        scenario(flow, "SLOW");
        tick(flow);
        long adaptiveAdmissions = adaptivePeople.stream().filter(person -> Boolean.TRUE.equals(status(flow, person).map().get("admitted"))).count();

        String fixedFlow = createFlow("item", 12);
        assertThat(request(HttpMethod.PUT, "/api/flows/" + fixedFlow + "/policy", Map.of(
            "maxConcurrent", 12, "admissionRate", 12, "holdSeconds", 5, "adaptive", false)).status()).isEqualTo(200);
        scenario(fixedFlow, "OUTAGE");
        List<Participant> fixedPeople = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            Participant person = session(fixedFlow);
            join(fixedFlow, person);
            fixedPeople.add(person);
        }
        scenario(fixedFlow, "SLOW");
        tick(fixedFlow);
        long fixedAdmissions = fixedPeople.stream().filter(person -> Boolean.TRUE.equals(status(fixedFlow, person).map().get("admitted"))).count();
        assertThat(adaptiveAdmissions).isPositive().isLessThan(fixedAdmissions);
        assertThat(fixedAdmissions).isEqualTo(12);
    }

    @Test
    void trafficRunExercisesRealServicesAndMatchesTheDurableLedger() {
        policy(flow, 12, 12, 30);
        scenario(flow, "NORMAL");
        Result started = request(HttpMethod.POST, "/api/flows/" + flow + "/load", Map.of("buyers", 6));
        assertThat(started.status()).isEqualTo(200);
        await(Duration.ofSeconds(15), () -> {
            tick(flow);
            return !Boolean.TRUE.equals(loadState(flow).get("running"));
        });
        Map<String, Object> run = loadState(flow);
        assertThat(number(run, "total")).isEqualTo(6);
        assertThat(number(run, "finished")).isEqualTo(6);
        assertThat(number(run, "failed")).isZero();
        assertThat(allocations.findByPoolId(flow)).hasSize((int) number(run, "completed"));
        assertThat(units(flow)).noneSatisfy(unit -> assertThat(unit.get("status")).isEqualTo("HELD"));
        assertThat(redis.opsForZSet().zCard("event:" + flow + ":waiting_room")).isZero();
    }

    @Test
    void stoppingVirtualTrafficDoesNotCancelARealParticipantsReservation() {
        policy(flow, 12, 12, 30);
        Participant person = admit(flow, session(flow));
        assertThat(claim("hold", flow, person, "slot-01").status()).isEqualTo(200);
        scenario(flow, "OUTAGE");
        assertThat(request(HttpMethod.POST, "/api/flows/" + flow + "/load", Map.of("buyers", 12)).status()).isEqualTo(200);
        assertThat(request(HttpMethod.POST, "/api/flows/" + flow + "/load/stop", null).status()).isEqualTo(200);
        await(Duration.ofSeconds(5), () -> !Boolean.TRUE.equals(loadState(flow).get("running")));
        assertThat(unit(flow, "slot-01").get("status")).isEqualTo("HELD");
        assertThat(status(flow, person).map().get("admitted")).isEqualTo(true);
        assertThat(redis.opsForZSet().zCard("event:" + flow + ":waiting_room")).isZero();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> loadState(String id) {
        Result snapshot = request(HttpMethod.GET, "/api/flows/" + id, null);
        assertThat(snapshot.status()).isEqualTo(200);
        return (Map<String, Object>) snapshot.map().get("load");
    }

    private String initialSseEvent(String id, Participant person) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port
            + "/api/waiting-room/" + id + "/stream?" + credentials(person)))
            .timeout(Duration.ofSeconds(5)).header("Accept", "text/event-stream").GET().build();
        try (HttpClient http = HttpClient.newHttpClient()) {
            HttpResponse<java.io.InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
            assertThat(response.statusCode()).isEqualTo(200);
            var executor = Executors.newVirtualThreadPerTaskExecutor();
            var reader = new BufferedReader(new InputStreamReader(response.body(), StandardCharsets.UTF_8));
            try {
                Future<String> event = executor.submit(() -> {
                    StringBuilder eventText = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) eventText.append(line).append('\n');
                    return eventText.toString();
                });
                try { return event.get(5, TimeUnit.SECONDS); }
                finally { response.body().close(); event.cancel(true); }
            } finally {
                executor.shutdownNow();
            }
        }
    }

    private String createFlow(String prefix, int units) {
        String id = "it-" + UUID.randomUUID();
        testFlows.add(id);
        Result result = request(HttpMethod.POST, "/api/pools/" + id + "/init?prefix=" + prefix + "&totalUnits=" + units, null);
        assertThat(result.status()).as("create isolated flow: %s", result.body()).isEqualTo(200);
        return id;
    }

    private void policy(String id, int capacity, int rate, int seconds) {
        Result result = request(HttpMethod.PUT, "/api/flows/" + id + "/policy", Map.of(
            "maxConcurrent", capacity, "admissionRate", rate, "holdSeconds", seconds, "adaptive", true));
        assertThat(result.status()).as("update policy: %s", result.body()).isEqualTo(200);
    }

    private void scenario(String id, String mode) {
        Result result = request(HttpMethod.POST, "/api/flows/" + id + "/scenario", Map.of("mode", mode));
        assertThat(result.status()).as("set scenario: %s", result.body()).isEqualTo(200);
    }

    private Participant session(String id) {
        Result result = request(HttpMethod.POST, "/api/flows/" + id + "/sessions", null);
        assertThat(result.status()).isEqualTo(200);
        return new Participant((String) result.map().get("claimantId"), (String) result.map().get("sessionToken"), null);
    }

    private Participant admit(String id, Participant person) {
        join(id, person);
        scenario(id, "NORMAL");
        tick(id);
        return admitted(id, person);
    }

    private void tick(String id) {
        // A manual test tick is a new observation window; production ticks remain rate limited.
        redis.delete("event:" + id + ":admission-tick");
        waitingRoom.processFlow(id);
    }

    private Participant admitted(String id, Participant person) {
        Result result = status(id, person);
        assertThat(result.map().get("admitted")).as("participant status: %s", result.body()).isEqualTo(true);
        return person.withAdmission((String) result.map().get("admissionToken"));
    }

    private Result join(String id, Participant person) {
        return request(HttpMethod.POST, "/api/waiting-room/" + id + "/join?" + credentials(person), null);
    }

    private Result status(String id, Participant person) {
        Result result = request(HttpMethod.GET, "/api/waiting-room/" + id + "/status?" + credentials(person), null);
        assertThat(result.status()).isEqualTo(200);
        return result;
    }

    private String credentials(Participant person) {
        return "userId=" + person.claimantId() + "&sessionToken=" + person.sessionToken();
    }

    private Result claim(String action, String id, Participant person, String unit) {
        return request(HttpMethod.POST, "/api/pools/" + id + "/" + action + "?sessionToken=" + person.sessionToken(),
            Map.of("claimantId", person.claimantId(), "unitId", unit, "admissionToken", person.admissionToken()));
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> units(String id) {
        Result result = request(HttpMethod.GET, "/api/pools/" + id + "/units", null);
        assertThat(result.status()).isEqualTo(200);
        return (List<Map<String, Object>>) result.body();
    }

    private Map<String, Object> unit(String id, String unitId) {
        return units(id).stream().filter(unit -> unitId.equals(unit.get("unitId"))).findFirst().orElseThrow();
    }

    private Result request(HttpMethod method, String path, Object body) {
        RestClient.RequestBodySpec request = client.method(method).uri(path).contentType(MediaType.APPLICATION_JSON);
        if (body != null) request.body(body);
        ResponseEntity<Object> response = request.retrieve().onStatus(code -> code.isError(), (req, res) -> {}).toEntity(Object.class);
        return new Result(response.getStatusCode().value(), response.getBody());
    }

    private long number(Map<String, Object> data, String field) { return ((Number) data.get(field)).longValue(); }

    private void await(Duration timeout, BooleanSupplier condition) {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() >= deadline) throw new AssertionError("Condition not met within " + timeout);
            try { Thread.sleep(100); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new AssertionError(interrupted); }
        }
    }

    private <T> List<T> parallel(int count, Callable<T> operation) {
        return parallel(java.util.stream.IntStream.range(0, count).mapToObj(index -> operation).toList());
    }

    private <T> List<T> parallel(List<Callable<T>> operations) {
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<T>> futures = operations.stream().map(operation -> executor.submit(() -> {
                if (!start.await(5, TimeUnit.SECONDS)) throw new AssertionError("Concurrent start timed out");
                return operation.call();
            })).toList();
            start.countDown();
            List<T> results = new ArrayList<>();
            for (Future<T> future : futures) results.add(future.get(20, TimeUnit.SECONDS));
            return results;
        } catch (Exception failure) { throw new AssertionError("Concurrent operation failed", failure); }
    }

    private record Participant(String claimantId, String sessionToken, String admissionToken) {
        Participant withAdmission(String token) { return new Participant(claimantId, sessionToken, token); }
    }

    private record Result(int status, Object body) {
        @SuppressWarnings("unchecked") Map<String, Object> map() { return (Map<String, Object>) body; }
    }
}
