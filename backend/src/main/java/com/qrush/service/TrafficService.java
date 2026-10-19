package com.qrush.service;

import com.qrush.dto.ClaimRequest;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

@Service
public class TrafficService {
    private final ExecutorService executor=Executors.newVirtualThreadPerTaskExecutor();
    private final Map<String,Run> runs=new ConcurrentHashMap<>();
    private final FlowRegistry flows;
    private final ParticipantSessions sessions;
    private final WaitingRoomService waiting;
    private final ResourceAllocationService resources;
    private final ActivityService activity;
    private static class Run {final int total;final AtomicInteger completed=new AtomicInteger(),failed=new AtomicInteger(),finished=new AtomicInteger();final AtomicBoolean stopped=new AtomicBoolean();Run(int total){this.total=total;}}
    public TrafficService(FlowRegistry flows,ParticipantSessions sessions,WaitingRoomService waiting,ResourceAllocationService resources,ActivityService activity){this.flows=flows;this.sessions=sessions;this.waiting=waiting;this.resources=resources;this.activity=activity;}
    public synchronized Map<String,Object> start(String id,int buyers){
        flows.get(id);
        if(buyers<1 || buyers>1000) throw new IllegalArgumentException("Choose 1–1000 virtual buyers.");
        Run previous=runs.get(id);
        if(previous!=null && previous.finished.get()<previous.total) throw new IllegalArgumentException("A traffic run is already active for this flow. Stop it before starting another.");
        Run run=new Run(buyers);runs.put(id,run);
        activity.record(id,"traffic","Started "+buyers+" virtual participants against real queue, reservation and confirmation services");
        for(int i=0;i<buyers;i++)executor.submit(()->worker(id,run));
        return state(id);
    }
    private void worker(String id,Run run){
        String user=null;String unit=null;String token=null;
        boolean confirmed=false;
        try{
            user=sessions.create(id).get("claimantId");
            waiting.joinQueue(id,user);
            long deadline=System.currentTimeMillis()+90000;
            while(!run.stopped.get() && System.currentTimeMillis()<deadline){
                var status=waiting.status(id,user);
                if(status.status().equals("SOLD_OUT") || status.status().equals("CONFIRMED"))break;
                if(status.admitted()){
                    token=status.admissionToken();
                    var available=resources.getUnitStatuses(id,null).stream().filter(u->u.status().equals("AVAILABLE")).toList();
                    if(available.isEmpty())break;
                    unit=available.get(ThreadLocalRandom.current().nextInt(available.size())).unitId();
                    var request=new ClaimRequest(unit,user,token);
                    if(resources.holdUnit(id,request).success()){
                        Thread.sleep(ThreadLocalRandom.current().nextInt(800,2200));
                        if(run.stopped.get())break;
                        // Deterministic per-client choice gives both settlement and abandonment activity.
                        if(Math.floorMod(user.hashCode(),5)==0){resources.releaseUnit(id,request);unit=null;break;}
                        var result=resources.confirmAllocation(id,request);
                        confirmed=result.success();
                        if(confirmed)run.completed.incrementAndGet();
                        break;
                    }
                }
                Thread.sleep(1000);
            }
        }catch(Exception e){run.failed.incrementAndGet();}
        finally{
            if(user!=null && !confirmed){try{if(unit!=null)resources.releaseUnit(id,new ClaimRequest(unit,user,token));waiting.leave(id,user);}catch(RuntimeException ignored){}}
            run.finished.incrementAndGet();
        }
    }
    public Map<String,Object> state(String id){Run run=runs.get(id);return run==null?Map.of("running",false,"total",0,"completed",0,"failed",0,"finished",0):Map.of("running",run.finished.get()<run.total,"total",run.total,"completed",run.completed.get(),"failed",run.failed.get(),"finished",run.finished.get());}
    public Map<String,Object> stop(String id){Run run=runs.get(id);if(run!=null)run.stopped.set(true);activity.record(id,"traffic","Stopping this flow's virtual participants; real participant reservations are preserved");return state(id);}
    @PreDestroy public void shutdown(){runs.values().forEach(run->run.stopped.set(true));executor.shutdownNow();}
}
