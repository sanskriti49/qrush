package com.qrush.service;

import com.qrush.dto.FlowPolicy;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class AdaptiveAdmissionEngine {
    public static final int MAX_CONCURRENT_CHECKOUTS=10;
    private final StringRedisTemplate redis;
    private final ChaosService chaos;
    private final FlowRegistry flows;
    public AdaptiveAdmissionEngine(StringRedisTemplate redis,ChaosService chaos,FlowRegistry flows) { this.redis=redis;this.chaos=chaos;this.flows=flows; }
    public int calculateAdmissionBatch(String flowId) {
        FlowPolicy policy=flows.get(flowId).policy();
        if(chaos.mode(flowId)==ChaosService.Mode.OUTAGE) { redis.opsForValue().set("flow:"+flowId+":rate","0");return 0; }
        int target=policy.admissionRate();
        if(policy.adaptive()) {
            long latency=Math.max(getLastObservedLatency(flowId),chaos.latency(flowId));
            if(latency>500) target=Math.max(1,target/5);
            String previous=redis.opsForValue().get("flow:"+flowId+":rate");
            int previousRate=previous==null ? target : Integer.parseInt(previous);
            target=Math.min(target,previousRate+1);
        }
        redis.opsForValue().set("flow:"+flowId+":rate",String.valueOf(target));
        return target;
    }
    public int getActiveCheckouts(String flowId) {
        Long count=redis.opsForZSet().count("event:"+flowId+":active_checkouts",System.currentTimeMillis()+1,Double.POSITIVE_INFINITY);
        return count==null ? 0 : count.intValue();
    }
    public void recordObservedLatency(String flowId,long ms) {
        String key="flow:"+flowId+":latency";
        String previous=redis.opsForValue().get(key);
        long average=previous==null ? ms : Math.round(Long.parseLong(previous)*0.7+ms*0.3);
        redis.opsForValue().set(key,String.valueOf(average));
        redis.opsForValue().set("flow:"+flowId+":latency-at",String.valueOf(System.currentTimeMillis()));
    }
    public long getLastObservedLatency(String flowId) {
        String value=redis.opsForValue().get("flow:"+flowId+":latency");
        String at=redis.opsForValue().get("flow:"+flowId+":latency-at");
        if(value==null || at==null || System.currentTimeMillis()-Long.parseLong(at)>5000) return 0;
        return Long.parseLong(value);
    }
    public int getAdmissionRate(String flowId) {
        if(chaos.mode(flowId)==ChaosService.Mode.OUTAGE) return 0;
        String value=redis.opsForValue().get("flow:"+flowId+":rate");
        return value==null ? flows.get(flowId).policy().admissionRate() : Integer.parseInt(value);
    }
    public int getAdmissionRate() { return getAdmissionRate("hackathon"); }
    public long getLastObservedLatency() { return getLastObservedLatency("hackathon"); }
}
