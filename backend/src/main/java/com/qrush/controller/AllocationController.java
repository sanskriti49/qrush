package com.qrush.controller;

import com.qrush.dto.*;
import com.qrush.service.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/pools/{poolId}")
public class AllocationController {
    private final ResourceAllocationService allocations;
    private final ParticipantSessions sessions;
    public AllocationController(ResourceAllocationService allocations,ParticipantSessions sessions){this.allocations=allocations;this.sessions=sessions;}
    @PostMapping("/init")
    public Map<String,Object> init(@PathVariable String poolId,@RequestParam(defaultValue="slot") String prefix,@RequestParam(defaultValue="100") int totalUnits){
        allocations.initializePool(poolId,prefix,totalUnits);return Map.of("poolId",poolId,"prefix",prefix,"totalUnits",totalUnits,"message","Resource catalog initialized without resetting existing reservations or allocations.");
    }
    @GetMapping("/units")
    public List<UnitStatusDto> units(@PathVariable String poolId,@RequestParam(required=false) String claimantId,@RequestParam(required=false) String sessionToken){
        if(claimantId!=null)sessions.validate(poolId,claimantId,sessionToken);
        return allocations.getUnitStatuses(poolId,claimantId);
    }
    @PostMapping("/hold") public ResponseEntity<ClaimResponse> hold(@PathVariable String poolId,@RequestBody ClaimRequest request,@RequestParam(required=false) String sessionToken){
        sessions.validate(poolId,request.claimantId(),sessionToken);return response(allocations.holdUnit(poolId,request));
    }
    @PostMapping("/confirm") public ResponseEntity<ClaimResponse> confirm(@PathVariable String poolId,@RequestBody ClaimRequest request,@RequestParam(required=false) String sessionToken){
        sessions.validate(poolId,request.claimantId(),sessionToken);return response(allocations.confirmAllocation(poolId,request));
    }
    @PostMapping("/release") public ResponseEntity<ClaimResponse> release(@PathVariable String poolId,@RequestBody ClaimRequest request,@RequestParam(required=false) String sessionToken){
        sessions.validate(poolId,request.claimantId(),sessionToken);return response(allocations.releaseUnit(poolId,request));
    }
    public record CancelRequest(String claimantId, UUID allocationId) {}
    @PostMapping("/cancel") public Map<String,Object> cancel(@PathVariable String poolId, @RequestBody CancelRequest request, @RequestParam(required=false) String sessionToken) {
        sessions.validate(poolId, request.claimantId(), sessionToken);
        if (request.allocationId() == null) throw new IllegalArgumentException("Choose the registration to cancel.");
        var booking = allocations.cancelAllocation(poolId, request.claimantId(), request.allocationId());
        return Map.of("allocationId", booking.getId(), "status", booking.getStatus(), "cancelledAt", booking.getCancelledAt());
    }
    @GetMapping("/allocation") public ResponseEntity<?> allocation(@PathVariable String poolId,@RequestParam String claimantId,@RequestParam(required=false) String sessionToken){
        sessions.validate(poolId,claimantId,sessionToken);
        return allocations.allocation(poolId,claimantId).map(a->ResponseEntity.ok(Map.of("allocationId",a.getId(),"unitId",a.getUnitId(),"claimantId",a.getClaimantId(),"poolId",a.getPoolId(),"confirmedAt",a.getConfirmedAt(),"status",a.getStatus()))).orElseGet(()->ResponseEntity.noContent().build());
    }
    private ResponseEntity<ClaimResponse> response(ClaimResponse response){return ResponseEntity.status(response.success()?200:409).body(response);}
}
