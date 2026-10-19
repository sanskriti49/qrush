package com.qrush.controller;

import com.qrush.dto.*;
import com.qrush.service.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/openings")
public class OpeningController {
    private final FlowRegistry flows;
    private final ResourceAllocationService resources;
    private final ParticipantSessions sessions;
    private final StringRedisTemplate redis;
    private final WaitingRoomService waiting;

    public OpeningController(FlowRegistry flows, ResourceAllocationService resources, ParticipantSessions sessions, StringRedisTemplate redis, WaitingRoomService waiting) {
        this.flows = flows; this.resources = resources; this.sessions = sessions; this.redis = redis; this.waiting = waiting;
    }

    public record CreateOpening(String name, String description, int capacity, Instant opensAt, UUID requestId) {}
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String,Object> create(@RequestBody CreateOpening request) {
        var flow = flows.createOpening(request.name(), request.description(), request.capacity(), request.opensAt(), request.requestId());
        resources.initializePool(flow.id(), flow.resourcePrefix(), flow.totalUnits());
        return summary(flow);
    }

    @GetMapping
    public List<Map<String,Object>> list() {
        return flows.all().stream().filter(FlowDefinition::published)
            .sorted(Comparator.comparing(FlowDefinition::createdAt).reversed()).map(this::summary).toList();
    }

    @GetMapping("/{id}")
    public Map<String,Object> detail(@PathVariable String id) { return summary(publicOpening(id)); }

    public record ReserveRequest(String claimantId, String admissionToken) {}
    @PostMapping("/{id}/reserve")
    public ClaimResponse reserve(@PathVariable String id, @RequestParam(required=false) String sessionToken, @RequestBody ReserveRequest request) {
        publicOpening(id);
        sessions.validate(id, request.claimantId(), sessionToken);
        flows.requireOpen(id);
        if (!waiting.validateAdmissionToken(id, request.claimantId(), request.admissionToken()))
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.CONFLICT, "Wait for your turn before claiming a spot.");
        String existing = redis.opsForValue().get("pool:"+id+":owner:"+request.claimantId());
        if (existing != null) return resources.holdUnit(id, new ClaimRequest(existing, request.claimantId(), request.admissionToken()));
        // Only an admitted participant can ask for a place; reuse the atomic hold mechanism.
        Set<String> candidates = redis.opsForSet().members("pool:"+id+":units:available");
        if (candidates != null) for (String unit : candidates.stream().sorted().toList()) {
            ClaimResponse result = resources.holdUnit(id, new ClaimRequest(unit, request.claimantId(), request.admissionToken()));
            if (result.success()) return result;
        }
        throw new org.springframework.web.server.ResponseStatusException(HttpStatus.CONFLICT, "No spot could be saved just now. Keep this page open while we check again.");
    }

    private FlowDefinition publicOpening(String id) {
        var flow = flows.get(id);
        if (!flow.published()) throw new NoSuchElementException("This opening could not be found.");
        return flow;
    }

    private Map<String,Object> summary(FlowDefinition flow) {
        String base = "pool:"+flow.id()+":";
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("id", flow.id()); result.put("name", flow.name()); result.put("description", flow.description());
        result.put("capacity", flow.totalUnits()); result.put("opensAt", flow.opensAt()); result.put("createdAt", flow.createdAt());
        result.put("available", Optional.ofNullable(redis.opsForSet().size(base+"units:available")).orElse(0L));
        result.put("reserved", Optional.ofNullable(redis.opsForZSet().zCard(base+"leases")).orElse(0L));
        result.put("confirmed", Optional.ofNullable(redis.opsForSet().size(base+"units:confirmed")).orElse(0L));
        result.put("waiting", Optional.ofNullable(redis.opsForZSet().zCard(WaitingRoomService.queueKey(flow.id()))).orElse(0L));
        result.put("status", flow.isOpen() ? "OPEN" : "SCHEDULED");
        result.put("registrationPath", "/#r/"+flow.id()); result.put("serverTime", Instant.now());
        return result;
    }
}
