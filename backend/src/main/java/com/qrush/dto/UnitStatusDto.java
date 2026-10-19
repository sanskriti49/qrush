package com.qrush.dto;
public record UnitStatusDto(String unitId,String status,Long leaseRemainingSeconds,boolean heldByYou) {}
