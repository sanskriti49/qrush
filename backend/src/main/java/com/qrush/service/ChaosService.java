package com.qrush.service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.util.Locale;

@Service
public class ChaosService {
    public enum Mode { NORMAL, SLOW, OUTAGE }
    private final StringRedisTemplate redis;
    private final ActivityService activity;
    public ChaosService(StringRedisTemplate redis,ActivityService activity) { this.redis=redis; this.activity=activity; }
    public Mode mode(String flowId) {
        String value=redis.opsForValue().get("flow:"+flowId+":scenario");
        return value == null ? Mode.NORMAL : Mode.valueOf(value);
    }
    public void setMode(String flowId,String value) {
        if(value==null) throw new IllegalArgumentException("Choose NORMAL, SLOW or OUTAGE.");
        Mode mode=Mode.valueOf(value.toUpperCase(Locale.ROOT));
        redis.opsForValue().set("flow:"+flowId+":scenario",mode.name());
        activity.record(flowId,"scenario","Downstream scenario set to " + mode);
    }
    public long latency(String flowId) { return mode(flowId)==Mode.SLOW ? 1000 : 0; }
    public void apply(String flowId) {
        if(mode(flowId)==Mode.OUTAGE) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Injected downstream outage. Your reservation remains valid until its expiry; retry after recovery.");
        long delay=latency(flowId);
        if(delay>0) {
            try { Thread.sleep(delay); }
            catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Confirmation interrupted; retry with the same session."); }
        }
    }
    public void setArtificialLatency(long ms) { if(ms<0 || ms>5000) throw new IllegalArgumentException("Delay must be 0–5000 ms."); setMode("hackathon",ms>0?"SLOW":"NORMAL"); }
    public long getArtificialLatency() { return latency("hackathon"); }
    public void setFaultInjection(boolean enabled) { setMode("hackathon",enabled?"OUTAGE":"NORMAL"); }
    public boolean isFaultInjectionEnabled() { return mode("hackathon")==Mode.OUTAGE; }
}
