package com.qrush.dto;

import java.util.UUID;

public record ClaimResponse(
    boolean success,
    UUID allocationId,
    String unitId,
    String message,
    long leaseTtlSeconds
) {}