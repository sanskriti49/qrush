package com.qrush.controller;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api")
public class HealthController {
    private final StringRedisTemplate redis;
    private final JdbcTemplate jdbc;
    public HealthController(StringRedisTemplate redis,JdbcTemplate jdbc){this.redis=redis;this.jdbc=jdbc;}
    @GetMapping("/health") public ResponseEntity<?> health(){
        boolean redisUp=false,postgresUp=false;
        try{redisUp="PONG".equals(redis.execute((org.springframework.data.redis.core.RedisCallback<String>) connection->connection.ping()));}catch(RuntimeException ignored){}
        try{postgresUp=Integer.valueOf(1).equals(jdbc.queryForObject("SELECT 1",Integer.class));}catch(RuntimeException ignored){}
        return ResponseEntity.status(redisUp&&postgresUp?200:503).body(Map.of("status",redisUp&&postgresUp?"UP":"DOWN","service","QRush admission and reservation engine","redis",redisUp?"UP":"DOWN","postgres",postgresUp?"UP":"DOWN","mode","LIVE_BACKEND"));
    }
}
