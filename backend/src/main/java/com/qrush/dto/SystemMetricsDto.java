package com.qrush.dto;

public record SystemMetricsDto(
    int activeCheckouts,
    int maxCapacity,
    int admissionRatePerSec,
    long observedLatencyMs,
    boolean chaosActive,
    long queueLength
) {}