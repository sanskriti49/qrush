package com.qrush.controller;

import com.qrush.dto.*;
import com.qrush.service.*;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/waiting-room/{eventId}")
public class WaitingRoomController {
    private final WaitingRoomService waiting;
    private final ParticipantSessions sessions;
    private final ResourceAllocationService allocations;
    public WaitingRoomController(WaitingRoomService waiting,ParticipantSessions sessions,ResourceAllocationService allocations){this.waiting=waiting;this.sessions=sessions;this.allocations=allocations;}
    @PostMapping("/join") public QueueStatusResponse join(@PathVariable String eventId,@RequestParam String userId,@RequestParam(required=false) String sessionToken){
        sessions.validate(eventId,userId,sessionToken);waiting.joinQueue(eventId,userId);return waiting.status(eventId,userId);
    }
    @GetMapping("/status") public QueueStatusResponse status(@PathVariable String eventId,@RequestParam String userId,@RequestParam(required=false) String sessionToken){
        sessions.validate(eventId,userId,sessionToken);return waiting.status(eventId,userId);
    }
    @PostMapping("/leave") public QueueStatusResponse leave(@PathVariable String eventId,@RequestParam String userId,@RequestParam(required=false) String sessionToken){
        sessions.validate(eventId,userId,sessionToken);
        waiting.leave(eventId,userId);return waiting.status(eventId,userId);
    }
    @GetMapping(value="/stream",produces=MediaType.TEXT_EVENT_STREAM_VALUE) public SseEmitter stream(@PathVariable String eventId,@RequestParam String userId,@RequestParam(required=false) String sessionToken){
        sessions.validate(eventId,userId,sessionToken);return waiting.createStream(eventId,userId);
    }
}
