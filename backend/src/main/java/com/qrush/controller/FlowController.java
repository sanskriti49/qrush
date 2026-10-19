package com.qrush.controller;

import com.qrush.dto.*;
import com.qrush.service.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/flows")
public class FlowController {
    private final FlowRegistry flows;private final ResourceAllocationService resources;private final ParticipantSessions sessions;private final AdaptiveAdmissionEngine engine;private final ActivityService activity;private final ChaosService chaos;private final TrafficService traffic;private final StringRedisTemplate redis;
    public FlowController(FlowRegistry flows,ResourceAllocationService resources,ParticipantSessions sessions,AdaptiveAdmissionEngine engine,ActivityService activity,ChaosService chaos,TrafficService traffic,StringRedisTemplate redis){this.flows=flows;this.resources=resources;this.sessions=sessions;this.engine=engine;this.activity=activity;this.chaos=chaos;this.traffic=traffic;this.redis=redis;}
    @GetMapping public List<FlowDefinition> list(){return flows.all();}
    @GetMapping("/{id}") public Map<String,Object> snapshot(@PathVariable String id,@RequestParam(required=false) String claimantId,@RequestParam(required=false) String sessionToken){
        var flow=flows.get(id);if(claimantId!=null)sessions.validate(id,claimantId,sessionToken);
        var units=resources.getUnitStatuses(id,claimantId);
        Map<String,Object> metrics=new LinkedHashMap<>();
        metrics.put("activeCheckouts",engine.getActiveCheckouts(id));metrics.put("maxCapacity",flow.policy().maxConcurrent());metrics.put("admissionRatePerSec",engine.getAdmissionRate(id));metrics.put("observedLatencyMs",engine.getLastObservedLatency(id));metrics.put("chaosActive",chaos.mode(id)!=ChaosService.Mode.NORMAL);metrics.put("queueLength",Optional.ofNullable(redis.opsForZSet().zCard(WaitingRoomService.queueKey(id))).orElse(0L));
        for(String state:List.of("AVAILABLE","HELD","CONFIRMED"))metrics.put(state.toLowerCase(Locale.ROOT),units.stream().filter(u->u.status().equals(state)).count());
        for(String name:List.of("requests","failures","recycled","admissions","confirmations"))metrics.put(name,activity.value(id,name));metrics.put("arrivals",activity.value(id,"joined"));metrics.put("mode",chaos.mode(id).name());
        Map<String,Object> result=new LinkedHashMap<>();result.put("id",id);result.put("name",flow.name());result.put("resourcePrefix",flow.resourcePrefix());result.put("totalUnits",flow.totalUnits());result.put("policy",flow.policy());result.put("metrics",metrics);result.put("inventory",units);result.put("events",activity.events(id));result.put("scenario",Map.of("mode",chaos.mode(id).name()));result.put("load",traffic.state(id));result.put("sampledAt",Instant.now());return result;
    }
    @PostMapping("/{id}/sessions") public Map<String,String> session(@PathVariable String id){return sessions.create(id);}
    @PutMapping("/{id}/policy") public FlowDefinition policy(@PathVariable String id,@RequestBody FlowPolicy policy){var flow=flows.updatePolicy(id,policy);activity.record(id,"policy","Policy updated: "+policy.maxConcurrent()+" active, "+policy.admissionRate()+" admissions/sec, "+policy.holdSeconds()+" second reservation");return flow;}
    public record ScenarioRequest(String mode){}
    @PostMapping("/{id}/scenario") public Map<String,Object> scenario(@PathVariable String id,@RequestBody ScenarioRequest request){flows.get(id);chaos.setMode(id,request.mode());return Map.of("mode",chaos.mode(id).name());}
    public record LoadRequest(int buyers){}
    @PostMapping("/{id}/load") public Map<String,Object> load(@PathVariable String id,@RequestBody LoadRequest request){return traffic.start(id,request.buyers());}
    @PostMapping("/{id}/load/stop") public Map<String,Object> stop(@PathVariable String id){flows.get(id);return traffic.stop(id);}
}
