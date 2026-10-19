package com.qrush.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "resource_allocations")
public class Allocation {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "pool_id", nullable = false)
    private String poolId;       // e.g. "hackathon-2026" or "sneaker-drop"

    @Column(name = "unit_id", nullable = false)
    private String unitId;       // e.g. "slot-42" or "item-09"

    @Column(name = "claimant_id", nullable = false)
    private String claimantId;   // User identifier

    @Column(nullable = false)
    private String status;       // "CONFIRMED"

    @Column(name = "confirmed_at", nullable = false)
    private Instant confirmedAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    public Allocation() {}

    public Allocation(String poolId, String unitId, String claimantId) {
        this.poolId = poolId;
        this.unitId = unitId;
        this.claimantId = claimantId;
        this.status = "CONFIRMED";
        this.confirmedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public String getPoolId() { return poolId; }
    public String getUnitId() { return unitId; }
    public String getClaimantId() { return claimantId; }
    public String getStatus() { return status; }
    public Instant getConfirmedAt() { return confirmedAt; }
    public Instant getCancelledAt() { return cancelledAt; }
    public void cancel() { this.status = "CANCELLED"; this.cancelledAt = Instant.now(); }
}
