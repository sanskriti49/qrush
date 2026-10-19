package com.qrush.controller;

import com.qrush.dto.SystemMetricsDto;
import com.qrush.service.AdaptiveAdmissionEngine;
import com.qrush.service.ChaosService;
import com.qrush.service.FlowRegistry;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/chaos")
public class ChaosController {

    private final ChaosService chaosService;
    private final AdaptiveAdmissionEngine admissionEngine;
    private final StringRedisTemplate redisTemplate;
    private final FlowRegistry flows;

    public ChaosController(
            ChaosService chaosService,
            AdaptiveAdmissionEngine admissionEngine,
            StringRedisTemplate redisTemplate, FlowRegistry flows) {
        this.chaosService = chaosService;
        this.admissionEngine = admissionEngine;
        this.redisTemplate = redisTemplate;
        this.flows = flows;
    }

    /**
     * Set artificial downstream latency (e.g. 500ms or 1500ms).
     */
    @PostMapping("/latency")
    public ResponseEntity<Map<String, Object>> setLatency(@RequestParam long delayMs) {
        chaosService.setArtificialLatency(delayMs);
        return ResponseEntity.ok(Map.of(
            "status", "UPDATED",
            "artificialLatencyMs", delayMs,
            "message", delayMs > 0 ? "Backend slowdown injected!" : "Backend running normally."
        ));
    }

    /**
     * Compatibility control: pause the hackathon downstream with an injected outage.
     */
    @PostMapping("/faults")
    public ResponseEntity<Map<String, Object>> toggleFaults(@RequestParam boolean enabled) {
        chaosService.setFaultInjection(enabled);
        return ResponseEntity.ok(Map.of(
            "status", "UPDATED",
            "faultsEnabled", enabled
        ));
    }

    /**
     * Get live telemetry for the Chaos Deck dashboard.
     */
    @GetMapping("/telemetry/{eventId}")
    public ResponseEntity<SystemMetricsDto> getMetrics(@PathVariable String eventId) {
        Long qLen = redisTemplate.opsForZSet().zCard("event:" + eventId + ":waiting_room");

        SystemMetricsDto metrics = new SystemMetricsDto(
            admissionEngine.getActiveCheckouts(eventId),
            flows.get(eventId).policy().maxConcurrent(),
            admissionEngine.getAdmissionRate(eventId),
            admissionEngine.getLastObservedLatency(eventId),
            chaosService.mode(eventId) != ChaosService.Mode.NORMAL,
            qLen != null ? qLen : 0L
        );

        return ResponseEntity.ok(metrics);
    }
}
