package com.qrush.controller;

import com.qrush.service.*;
import com.qrush.repository.AllocationRepository;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@RestController
@RequestMapping("/api/registrations")
public class RegistrationController {
    private final ParticipantSessions sessions;
    private final FlowRegistry flows;
    private final AllocationRepository allocations;
    private final WaitingRoomService waiting;

    public RegistrationController(ParticipantSessions sessions, FlowRegistry flows, AllocationRepository allocations, WaitingRoomService waiting) {
        this.sessions = sessions; this.flows = flows; this.allocations = allocations; this.waiting = waiting;
    }
    public record Reference(String flowId, String claimantId, String sessionToken) {}
    public record Lookup(List<Reference> sessions) {}

    @PostMapping("/lookup")
    public List<Map<String,Object>> lookup(@RequestBody Lookup request) {
        if (request.sessions() == null || request.sessions().size() > 50) throw new IllegalArgumentException("Check up to 50 saved registrations at a time.");
        List<Map<String,Object>> result = new ArrayList<>();
        for (var reference : request.sessions()) {
            if (reference == null) throw new IllegalArgumentException("A saved registration is missing.");
            Map<String,Object> item = new LinkedHashMap<>();
            item.put("flowId", reference.flowId() == null ? "" : reference.flowId());
            try {
                sessions.validate(reference.flowId(), reference.claimantId(), reference.sessionToken());
                var flow = flows.get(reference.flowId());
                item.put("name", flow.name()); item.put("description", flow.description()); item.put("opensAt", flow.opensAt());
                item.put("published", flow.published());
                item.put("queue", waiting.status(reference.flowId(), reference.claimantId()));
                item.put("history", allocations.findByPoolIdAndClaimantIdOrderByConfirmedAtDesc(reference.flowId(), reference.claimantId()).stream().map(a -> {
                    Map<String,Object> booking = new LinkedHashMap<>();
                    booking.put("allocationId", a.getId()); booking.put("unitId", a.getUnitId()); booking.put("status", a.getStatus());
                    booking.put("confirmedAt", a.getConfirmedAt()); booking.put("cancelledAt", a.getCancelledAt()); return booking;
                }).toList());
                item.put("status", "OK");
            } catch (ResponseStatusException e) {
                if (e.getStatusCode().value() != 401) throw e;
                item.put("status", "SESSION_EXPIRED");
            } catch (NoSuchElementException e) { item.put("status", "NOT_FOUND"); }
            result.add(item);
        }
        return result;
    }
}
