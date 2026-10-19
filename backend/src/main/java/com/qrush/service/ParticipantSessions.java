package com.qrush.service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

@Service
public class ParticipantSessions {
    private final StringRedisTemplate redis;
    private final FlowRegistry flows;
    public ParticipantSessions(StringRedisTemplate redis, FlowRegistry flows) { this.redis = redis; this.flows = flows; }
    public Map<String,String> create(String flowId) {
        flows.get(flowId);
        String user = "participant-" + UUID.randomUUID();
        String token = UUID.randomUUID().toString() + UUID.randomUUID();
        redis.opsForValue().set(key(flowId,user), token, Duration.ofDays(7));
        return Map.of("claimantId", user, "sessionToken", token);
    }
    public void validate(String flowId, String user, String token) {
        flows.get(flowId);
        if (user == null || !user.matches("participant-[a-f0-9-]{36}") || token == null) throw unauthorized();
        String stored = redis.opsForValue().get(key(flowId,user));
        if (stored == null || !MessageDigest.isEqual(stored.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8))) throw unauthorized();
    }
    private String key(String flowId,String user) { return "flow:" + flowId + ":session:" + user; }
    private ResponseStatusException unauthorized() { return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Your participant session is missing or expired. Start a new participant journey."); }
}
