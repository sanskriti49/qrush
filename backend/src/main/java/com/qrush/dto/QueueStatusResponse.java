package com.qrush.dto;
public record QueueStatusResponse(long position,long totalInQueue,long estimatedWaitSeconds,boolean admitted,String admissionToken,String status,long admissionRemainingSeconds,String heldUnitId,long holdRemainingSeconds) {}
