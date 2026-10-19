package com.qrush.service;

import com.qrush.dto.QueueStatusResponse;
import com.qrush.repository.AllocationRepository;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Service
public class WaitingRoomService {
    private static final Logger log=LoggerFactory.getLogger(WaitingRoomService.class);
    private final StringRedisTemplate redis;
    private final FlowRegistry flows;
    private final AdaptiveAdmissionEngine engine;
    private final ActivityService activity;
    private final AllocationRepository allocations;
    private final Map<String,SseEmitter> emitters=new ConcurrentHashMap<>();
    private final DefaultRedisScript<Long> joinScript=script("scripts/join_queue.lua");
    private final DefaultRedisScript<Long> admitScript=script("scripts/admit_queue.lua");
    private final DefaultRedisScript<Long> leaveScript=script("scripts/leave_queue.lua");
    @Value("${qrush.scheduling.enabled:true}") private boolean schedulingEnabled;

    public WaitingRoomService(StringRedisTemplate redis,FlowRegistry flows,AdaptiveAdmissionEngine engine,ActivityService activity,AllocationRepository allocations) {
        this.redis=redis;this.flows=flows;this.engine=engine;this.activity=activity;this.allocations=allocations;
    }
    private DefaultRedisScript<Long> script(String path) { DefaultRedisScript<Long> script=new DefaultRedisScript<>();script.setLocation(new ClassPathResource(path));script.setResultType(Long.class);return script; }
    public static String queueKey(String id) {return "event:"+id+":waiting_room";}
    public static String activeKey(String id) {return "event:"+id+":active_checkouts";}
    public static String tokenKey(String id,String user) {return "event:"+id+":admitted:"+user;}
    public void joinQueue(String id,String user) {
        flows.requireOpen(id);
        if(Boolean.TRUE.equals(redis.hasKey("pool:"+id+":allocation:"+user))) return;
        Long result=redis.execute(joinScript,List.of(queueKey(id),"event:"+id+":sequence",tokenKey(id,user)),user);
        if(result!=null && result<0) throw new IllegalArgumentException("This waiting room has reached its 10,000 participant safety limit.");
        if(Long.valueOf(1).equals(result)) {activity.record(id,"queue","A participant joined the waiting room");activity.count(id,"joined");}
    }
    public QueueStatusResponse status(String id,String user) {
        var flow=flows.get(id);
        long total=Optional.ofNullable(redis.opsForZSet().zCard(queueKey(id))).orElse(0L);
        if(Boolean.TRUE.equals(redis.hasKey("pool:"+id+":allocation:"+user))) return new QueueStatusResponse(0,total,0,false,null,"CONFIRMED",0,null,0);
        long confirmed=Optional.ofNullable(redis.opsForSet().size("pool:"+id+":units:confirmed")).orElse(0L);
        if(confirmed>=flow.totalUnits()) {
            Long queuedRank = redis.opsForZSet().rank(queueKey(id),user);
            return new QueueStatusResponse(queuedRank == null ? 0 : queuedRank+1,total,0,false,null,"SOLD_OUT",0,null,0);
        }
        String token=redis.opsForValue().get(tokenKey(id,user));
        String held=redis.opsForValue().get("pool:"+id+":owner:"+user);
        long holdTtl=held==null ? 0 : Math.max(0,(Optional.ofNullable(redis.getExpire("pool:"+id+":hold:"+held,TimeUnit.MILLISECONDS)).orElse(0L)+999)/1000);
        if(token!=null) return new QueueStatusResponse(0,total,0,true,token,"ADMITTED",Math.max(0,Optional.ofNullable(redis.getExpire(tokenKey(id,user),TimeUnit.SECONDS)).orElse(0L)),holdTtl>0?held:null,holdTtl);
        Long rank=redis.opsForZSet().rank(queueKey(id),user);
        if(rank==null) return new QueueStatusResponse(0,total,0,false,null,"NOT_JOINED",0,null,0);
        long position=rank+1;
        int rate=engine.getAdmissionRate(id);
        // Estimate is explicitly unknown while full or paused; hold duration alone is not service throughput.
        long estimate=rate==0 || engine.getActiveCheckouts(id)>=flows.get(id).policy().maxConcurrent() ? -1 : (long)Math.ceil((double)position/rate);
        return new QueueStatusResponse(position,total,estimate,false,null,"WAITING",0,null,0);
    }
    public boolean validateAdmissionToken(String id,String user,String token) {
        if(token==null) return false;
        String stored=redis.opsForValue().get(tokenKey(id,user));
        Double expiry=redis.opsForZSet().score(activeKey(id),user);
        return stored!=null && stored.equals(token) && expiry!=null && expiry>System.currentTimeMillis();
    }
    public void completeAdmission(String id,String user) {
        redis.delete(tokenKey(id,user));
        redis.opsForZSet().remove(activeKey(id),user);
        redis.opsForZSet().remove(queueKey(id),user);
    }
    public void leave(String id,String user) {
        Long result=redis.execute(leaveScript,List.of(queueKey(id),activeKey(id),tokenKey(id,user),"pool:"+id+":owner:"+user,"pool:"+id+":units:available","pool:"+id+":units:confirmed","pool:"+id+":leases"),user,"pool:"+id+":");
        if(Long.valueOf(-1).equals(result))throw new ResponseStatusException(HttpStatus.CONFLICT,"Confirmation is already settling. Wait for its durable result before leaving.");
        if(Long.valueOf(1).equals(result))activity.count(id,"recycled");
        activity.record(id,"queue","A participant left the waiting room");
    }
    @Scheduled(fixedDelayString="${qrush.engine.tick-ms:1000}")
    public void scheduledTick() { if(schedulingEnabled) processQueueAndBroadcast(); }
    public void processQueueAndBroadcast() {
        for(var flow:flows.all()) {
            try {processFlow(flow.id());}catch(RuntimeException e){log.warn("Queue tick failed closed for flow {}",flow.id());}
        }
        for(var entry:emitters.entrySet()) {
            String[] parts=entry.getKey().split(":",2);
            try{send(entry.getKey(),entry.getValue(),status(parts[0],parts[1]));}catch(RuntimeException e){emitters.remove(entry.getKey(),entry.getValue());entry.getValue().completeWithError(e);}
        }
    }
    public void processFlow(String id) {
            var flow=flows.get(id);
            if (!flow.isOpen()) return;
            int batch=engine.calculateAdmissionBatch(id);
            Long admitted=redis.execute(admitScript,List.of(queueKey(id),activeKey(id),"event:"+id+":admission-tick","pool:"+id+":units:available"),
                String.valueOf(System.currentTimeMillis()),String.valueOf(flow.policy().maxConcurrent()),String.valueOf(batch),
                "event:"+id+":admitted:",UUID.randomUUID().toString()+":","0","30","pool:"+id+":owner:");
            if(admitted!=null && admitted>0) activity.record(id,"admission",admitted+" participants admitted; configured concurrency cap "+flow.policy().maxConcurrent());
            if(admitted!=null && admitted>0) redis.opsForHash().increment("flow:"+id+":metrics","admissions",admitted);
    }
    public SseEmitter createStream(String id,String user) {
        SseEmitter emitter=new SseEmitter(30*60*1000L);
        String key=id+":"+user;
        SseEmitter old=emitters.put(key,emitter);
        if(old!=null) old.complete();
        Runnable remove=()->emitters.remove(key,emitter);
        emitter.onCompletion(remove);emitter.onTimeout(remove);emitter.onError(e->remove.run());
        send(key,emitter,status(id,user));
        return emitter;
    }
    private void send(String key,SseEmitter emitter,QueueStatusResponse status) {
        try {emitter.send(SseEmitter.event().name("QUEUE_UPDATE").data(status));}
        catch(Exception ignored) {emitters.remove(key,emitter);emitter.complete();}
    }
}
