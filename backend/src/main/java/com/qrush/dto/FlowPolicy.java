package com.qrush.dto;

public record FlowPolicy(int maxConcurrent, int admissionRate, int holdSeconds, boolean adaptive) {
    public FlowPolicy {
        if (maxConcurrent < 1 || maxConcurrent > 100 || admissionRate < 1 || admissionRate > 100 || holdSeconds < 5 || holdSeconds > 900) {
            throw new IllegalArgumentException("Capacity and admission rate must be 1–100; reservation duration must be 5–900 seconds.");
        }
    }
}
