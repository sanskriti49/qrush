package com.qrush.repository;

import com.qrush.model.Allocation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface AllocationRepository extends JpaRepository<Allocation, UUID> {
    @Query("select a from Allocation a where a.poolId = ?1 and a.unitId = ?2 and a.status = 'CONFIRMED'")
    Optional<Allocation> findByPoolIdAndUnitId(String poolId, String unitId);
    @Query("select a from Allocation a where a.poolId = ?1 and a.claimantId = ?2 and a.status = 'CONFIRMED'")
    Optional<Allocation> findByPoolIdAndClaimantId(String poolId, String claimantId);
    List<Allocation> findByPoolIdAndClaimantIdOrderByConfirmedAtDesc(String poolId, String claimantId);
    List<Allocation> findByPoolId(String poolId);
}
