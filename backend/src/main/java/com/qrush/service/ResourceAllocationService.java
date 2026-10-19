package com.qrush.service;

import com.qrush.dto.*;
import com.qrush.model.Allocation;
import com.qrush.repository.AllocationRepository;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.*;
import java.util.concurrent.TimeUnit;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public class ResourceAllocationService {
    private static final Logger log=LoggerFactory.getLogger(ResourceAllocationService.class);
    public static final long LEASE_TTL_SECONDS=300;
    private final StringRedisTemplate redis;
    private final AllocationRepository allocations;
    private final FlowRegistry flows;
    private final WaitingRoomService waiting;
    private final AdaptiveAdmissionEngine engine;
    private final ChaosService chaos;
    private final ActivityService activity;
    private final TransactionTemplate transactions;
    private final JdbcTemplate jdbc;
    private final DefaultRedisScript<Long> hold=script("hold_unit");
    private final DefaultRedisScript<Long> release=script("release_unit");
    private final DefaultRedisScript<Long> begin=script("begin_settlement");
    private final DefaultRedisScript<Long> settle=script("settle_unit");
    private final DefaultRedisScript<Long> recycle=script("recycle_unit");
    private final DefaultRedisScript<Long> initialize=script("initialize_unit");
    private final DefaultRedisScript<Long> rollback=script("rollback_settlement");
    private final DefaultRedisScript<Long> cancel=script("cancel_allocation");
    private final DefaultRedisScript<List> unitStatus=new DefaultRedisScript<>();
    @Value("${qrush.scheduling.enabled:true}") private boolean schedulingEnabled;
    public ResourceAllocationService(StringRedisTemplate redis,AllocationRepository allocations,FlowRegistry flows,WaitingRoomService waiting,AdaptiveAdmissionEngine engine,ChaosService chaos,ActivityService activity,TransactionTemplate transactions,JdbcTemplate jdbc) {
        this.redis=redis;this.allocations=allocations;this.flows=flows;this.waiting=waiting;this.engine=engine;this.chaos=chaos;this.activity=activity;this.transactions=transactions;this.jdbc=jdbc;
        this.unitStatus.setLocation(new ClassPathResource("scripts/unit_status.lua"));
        this.unitStatus.setResultType(List.class);
    }
    private DefaultRedisScript<Long> script(String name) {var s=new DefaultRedisScript<Long>();s.setLocation(new ClassPathResource("scripts/"+name+".lua"));s.setResultType(Long.class);return s;}
    private String base(String id) {return "pool:"+id+":";}
    private String available(String id){return base(id)+"units:available";}
    private String confirmed(String id){return base(id)+"units:confirmed";}
    private String catalog(String id){return base(id)+"units";}
    private String held(String id,String unit){return base(id)+"hold:"+unit;}
    private String owner(String id,String user){return base(id)+"owner:"+user;}
    private String finalizing(String id,String unit){return base(id)+"finalizing:"+unit;}
    private String leases(String id){return base(id)+"leases";}
    private String settlements(String id){return base(id)+"settlements";}
    @PostConstruct public void initializeDefaults(){for(var f:flows.all()) initializePool(f.id(),f.resourcePrefix(),f.totalUnits());}
    public void initializePool(String id,String prefix,int count) {
        var flow=flows.create(id,id,prefix,count);
        // Never delete a live pool. Rehydrate confirmed allocations before advertising availability.
        rebuildProjection(id);
        for(String unit:unitIds(flow)) redis.execute(initialize,List.of(catalog(id),confirmed(id),held(id,unit),finalizing(id,unit),available(id)),unit);
    }
    public List<String> unitIds(FlowDefinition flow){List<String> units=new ArrayList<>();for(int i=1;i<=flow.totalUnits();i++) units.add(flow.resourcePrefix()+"-"+String.format("%02d",i));return units;}
    public ClaimResponse holdUnit(String id,ClaimRequest request) {
        var flow=flows.get(id); flows.requireOpen(id); validateRequest(request);
        activity.count(id,"requests");
        if(!waiting.validateAdmissionToken(id,request.claimantId(),request.admissionToken())) {
            activity.count(id,"failures");
            return failure(request.unitId(),"Join the waiting room and wait for a valid admission token.");
        }
        if(allocations.findByPoolIdAndClaimantId(id,request.claimantId()).isPresent()) return failure(request.unitId(),"You already have a confirmed allocation in this flow.");
        Long result=redis.execute(hold,List.of(available(id),held(id,request.unitId()),confirmed(id),owner(id,request.claimantId()),WaitingRoomService.tokenKey(id,request.claimantId()),WaitingRoomService.activeKey(id),catalog(id),leases(id),finalizing(id,request.unitId())),
            request.unitId(),request.claimantId(),String.valueOf(flow.policy().holdSeconds()),request.admissionToken()==null?"":request.admissionToken(),String.valueOf(System.currentTimeMillis()));
        if(Long.valueOf(1).equals(result)||Long.valueOf(2).equals(result)) {
            long ttl=Math.max(0,(Optional.ofNullable(redis.getExpire(held(id,request.unitId()),TimeUnit.MILLISECONDS)).orElse(0L)+999)/1000);
            if(Long.valueOf(1).equals(result)){activity.record(id,"reservation","Reserved "+request.unitId()+" for "+ttl+" seconds");activity.count(id,"holds");}
            return new ClaimResponse(true,null,request.unitId(),"Reservation active. Confirm before it expires.",ttl);
        }
        activity.count(id,"failures");
        return failure(request.unitId(),Long.valueOf(-2).equals(result)?"Join the waiting room and wait for a valid admission token.":Long.valueOf(-3).equals(result)?"You already hold another resource. Release it before switching.":Long.valueOf(-4).equals(result)?"This resource does not exist in the flow.":"This resource is already held or confirmed.");
    }
    public ClaimResponse releaseUnit(String id,ClaimRequest request) {
        flows.get(id);validateRequest(request);
        Long result=redis.execute(release,List.of(available(id),held(id,request.unitId()),confirmed(id),owner(id,request.claimantId()),leases(id),finalizing(id,request.unitId()),WaitingRoomService.tokenKey(id,request.claimantId()),WaitingRoomService.activeKey(id),WaitingRoomService.queueKey(id)),request.unitId(),request.claimantId(),request.admissionToken()==null?"":request.admissionToken());
        if(Long.valueOf(1).equals(result)) {activity.count(id,"recycled");activity.record(id,"recycle","Released "+request.unitId()+" back to the available pool");return new ClaimResponse(true,null,request.unitId(),"Reservation released.",0);}
        return failure(request.unitId(),"Only an active reservation holder can release this resource; an in-flight confirmation cannot be released.");
    }
    public ClaimResponse confirmAllocation(String id,ClaimRequest request) {
        flows.get(id);validateRequest(request);activity.count(id,"requests");
        long start=System.nanoTime();
        try {
            // Read durable result before checking a potentially expired Redis lease.
            Optional<Allocation> existing=allocations.findByPoolIdAndClaimantId(id,request.claimantId());
            if(existing.isPresent()){safeSettle(existing.get());return success(existing.get(),"Allocation already confirmed.");}
            chaos.apply(id);
            AtomicBoolean created=new AtomicBoolean(false);
            Allocation result=transactions.execute(status->{
                lockPool(id);
                var duplicate=allocations.findByPoolIdAndClaimantId(id,request.claimantId());
                if(duplicate.isPresent()) return duplicate.get();
                if(!waiting.validateAdmissionToken(id,request.claimantId(),request.admissionToken())) return null;
                if(allocations.findByPoolIdAndUnitId(id,request.unitId()).isPresent()) return null;
                String fence=UUID.randomUUID().toString();
                Long acquired=redis.execute(begin,List.of(held(id,request.unitId()),finalizing(id,request.unitId()),WaitingRoomService.tokenKey(id,request.claimantId()),owner(id,request.claimantId()),leases(id),settlements(id)),
                    request.claimantId(),fence,request.admissionToken(),request.unitId(),String.valueOf(System.currentTimeMillis()));
                if(!Long.valueOf(1).equals(acquired)) return null;
                Allocation saved=allocations.saveAndFlush(new Allocation(id,request.unitId(),request.claimantId()));
                created.set(true);
                return saved;
            });
            if(result==null) {activity.count(id,"failures");return failure(request.unitId(),"Reservation expired, admission invalid, or resource unavailable. Rejoin to try again.");}
            // TransactionTemplate has committed. Redis is a projection and can be repaired after failure.
            safeSettle(result);
            if(created.get()) {
                activity.count(id,"confirmations");
                activity.record(id,"confirmation","Confirmed "+result.getUnitId()+" in PostgreSQL");
            }
            return success(result,created.get()?"Allocation durably confirmed.":"Allocation already confirmed.");
        } catch(RuntimeException exception) {
            activity.count(id,"failures");
            throw exception;
        } finally {engine.recordObservedLatency(id,TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start));}
    }
    public Optional<Allocation> allocation(String id,String user){flows.get(id);return allocations.findByPoolIdAndClaimantId(id,user);}
    public Allocation cancelAllocation(String id, String user, UUID allocationId) {
        flows.get(id);
        AtomicBoolean changed = new AtomicBoolean(false);
        Allocation result = transactions.execute(status -> {
            lockPool(id);
            Allocation booking = allocations.findById(allocationId)
                .filter(a -> a.getPoolId().equals(id) && a.getClaimantId().equals(user))
                .orElseThrow(() -> new NoSuchElementException("This registration could not be found."));
            if ("CONFIRMED".equals(booking.getStatus())) {
                booking.cancel();
                allocations.saveAndFlush(booking);
                changed.set(true);
            }
            return booking;
        });
        // Commit first. A failed cache update is repaired from the cancellation history.
        safeSettle(result);
        if (changed.get()) {
            activity.count(id, "recycled");
            activity.record(id, "recycle", "A booking was cancelled. Its spot is available again.");
        }
        return result;
    }
    private ClaimResponse success(Allocation a,String message){return new ClaimResponse(true,a.getId(),a.getUnitId(),message,0);}
    private ClaimResponse failure(String unit,String message){return new ClaimResponse(false,null,unit,message,0);}
    private void validateRequest(ClaimRequest request){
        if(request==null || request.unitId()==null || !request.unitId().matches("[A-Za-z0-9_-]{1,100}") || request.claimantId()==null) throw new IllegalArgumentException("A valid resource and participant are required.");
    }
    private void lockPool(String id){
        jdbc.execute((ConnectionCallback<Void>) connection->{
            try(var statement=connection.prepareStatement("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))")){
                statement.setString(1,"qrush:"+id);statement.execute();
            }return null;
        });
    }
    private void settleDurable(Allocation a){
        String id=a.getPoolId(),unit=a.getUnitId(),user=a.getClaimantId();
        redis.execute(settle,List.of(confirmed(id),available(id),held(id,unit),owner(id,user),finalizing(id,unit),leases(id),settlements(id),WaitingRoomService.tokenKey(id,user),WaitingRoomService.activeKey(id),WaitingRoomService.queueKey(id),base(id)+"allocation:"+user),unit,user,a.getId().toString());
    }
    private void projectCancelled(Allocation a, boolean releaseSpot) {
        String id = a.getPoolId(), unit = a.getUnitId();
        redis.execute(cancel, List.of(confirmed(id), available(id), base(id)+"allocation:"+a.getClaimantId(), held(id,unit), finalizing(id,unit)), unit, a.getId().toString(), releaseSpot ? "1" : "0");
    }
    private void safeSettle(Allocation a) {
        try {
            transactions.execute(status -> {
                lockPool(a.getPoolId());
                // Re-read under the same lock as cancellation. A delayed confirmation response
                // or retry must never resurrect a cancelled booking or erase its new owner.
                Allocation current = allocations.findById(a.getId()).orElseThrow();
                if ("CONFIRMED".equals(current.getStatus())) settleDurable(current);
                else {
                    var replacement = allocations.findByPoolIdAndUnitId(a.getPoolId(), a.getUnitId());
                    projectCancelled(current, replacement.isEmpty());
                    if (replacement.isPresent()) settleDurable(replacement.get());
                }
                return null;
            });
        } catch(RuntimeException e) { log.warn("Durable allocation {} committed; cache projection will reconcile",a.getId()); }
    }
    private void rebuildProjection(String id) {
        transactions.execute(status -> {
            lockPool(id);
            var history = allocations.findByPoolId(id);
            Set<String> activeUnits = new HashSet<>();
            for (var a : history) if ("CONFIRMED".equals(a.getStatus())) activeUnits.add(a.getUnitId());
            for (var a : history) if (!"CONFIRMED".equals(a.getStatus())) projectCancelled(a, !activeUnits.contains(a.getUnitId()));
            for (var a : history) if ("CONFIRMED".equals(a.getStatus())) settleDurable(a);
            return null;
        });
    }
    public List<UnitStatusDto> getUnitStatuses(String id,String ignoredPrefix,int ignoredCount){return getUnitStatuses(id,null);}
    public List<UnitStatusDto> getUnitStatuses(String id,String user){
        var flow=flows.get(id);
        recyclePool(id);
        reconcileDurable(id);
        List<UnitStatusDto> result=new ArrayList<>();
        for(String unit:unitIds(flow)){
            List state=redis.execute(unitStatus,List.of(confirmed(id),held(id,unit),available(id)),unit);
            if(state==null || state.size()!=3) throw new IllegalStateException("Inventory state could not be read consistently.");
            result.add(new UnitStatusDto(unit,state.get(0).toString(),Long.parseLong(state.get(1).toString()),user!=null && user.equals(state.get(2).toString())));
        }
        return result;
    }
    @Scheduled(fixedDelayString="${qrush.engine.tick-ms:1000}")
    public void scheduledRecycle(){if(schedulingEnabled) recycleAbandonedLeases();}
    public void recycleAbandonedLeases(){for(var flow:flows.all())try{recyclePool(flow.id());reconcileDurable(flow.id());}catch(RuntimeException e){log.warn("Lease reconciliation failed closed for flow {}",flow.id());}}
    private void reconcileDurable(String id){
        // Shared Redis gate prevents every waiting participant's inventory poll from querying SQL.
        if(Boolean.TRUE.equals(redis.opsForValue().setIfAbsent("flow:"+id+":reconcile-gate","1",Duration.ofSeconds(5)))){
            rebuildProjection(id);
        }
    }
    private void recyclePool(String id){
        long now=System.currentTimeMillis();
        Set<String> expired=redis.opsForZSet().rangeByScore(leases(id),0,now);
        if(expired!=null)for(String unit:expired){
            Long recycled=redis.execute(recycle,List.of(available(id),held(id,unit),confirmed(id),finalizing(id,unit),leases(id),catalog(id)),unit);
            if(Long.valueOf(1).equals(recycled)){activity.count(id,"recycled");activity.record(id,"recycle","Expired reservation "+unit+" returned to inventory");}
        }
        Set<String> pending=redis.opsForZSet().rangeByScore(settlements(id),0,now);
        if(pending!=null)for(String unit:pending)recoverSettlement(id,unit);
    }
    private void recoverSettlement(String id,String unit){
        transactions.execute(status->{
            lockPool(id);
            var durable=allocations.findByPoolIdAndUnitId(id,unit);
            if(durable.isPresent()){settleDurable(durable.get());return null;}
            String fence=redis.opsForValue().get(finalizing(id,unit));
            if(fence==null) return null;
            String holder=redis.opsForValue().get(held(id,unit));
            // All settlement attempts hold the same DB lock, so an absent durable row now proves rollback.
            String user=holder==null?"orphan":holder;
            redis.execute(rollback,List.of(finalizing(id,unit),held(id,unit),owner(id,user),settlements(id),available(id),confirmed(id),WaitingRoomService.tokenKey(id,user),WaitingRoomService.activeKey(id),WaitingRoomService.queueKey(id)),fence,unit,user);
            activity.count(id,"recycled");activity.record(id,"recovery","Recovered an interrupted confirmation for "+unit);
            return null;
        });
    }
}
