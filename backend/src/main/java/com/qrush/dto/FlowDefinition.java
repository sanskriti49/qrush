package com.qrush.dto;

import java.time.Instant;

public record FlowDefinition(String id, String name, String resourcePrefix, int totalUnits,
                             FlowPolicy policy, String description, Instant opensAt,
                             Instant createdAt, boolean published) {
    public boolean isOpen() { return !Instant.now().isBefore(opensAt); }
}
