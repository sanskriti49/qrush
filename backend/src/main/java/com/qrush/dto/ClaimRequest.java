package com.qrush.dto;

public record ClaimRequest(
    String unitId,
    String claimantId,
    String admissionToken
) {}