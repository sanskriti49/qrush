package com.qrush.service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.*;

@Service
public class ActivityService {
    private final StringRedisTemplate redis;
    public ActivityService(StringRedisTemplate redis) { this.redis=redis; }
    public void record(String flowId,String type,String message) {
        String event = UUID.randomUUID() + "\t" + Instant.now() + "\t" + type + "\t" + message.replace('\t',' ');
        redis.opsForList().leftPush("flow:"+flowId+":events", event);
        redis.opsForList().trim("flow:"+flowId+":events", 0, 99);
    }
    public void count(String flowId,String metric) { redis.opsForHash().increment("flow:"+flowId+":metrics",metric,1); }
    public long value(String flowId,String metric) { Object value=redis.opsForHash().get("flow:"+flowId+":metrics",metric); return value == null ? 0 : Long.parseLong(value.toString()); }
    public List<Map<String,String>> events(String flowId) {
        List<String> rows=redis.opsForList().range("flow:"+flowId+":events",0,39);
        if(rows==null) return List.of();
        return rows.stream().map(row->{ String[] p=row.split("\t",4); return Map.of("id",p[0],"at",p[1],"type",p[2],"message",p[3]); }).toList();
    }
}
