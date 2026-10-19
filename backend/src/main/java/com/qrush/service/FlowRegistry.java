package com.qrush.service;

import com.qrush.dto.FlowDefinition;
import com.qrush.dto.FlowPolicy;
import jakarta.annotation.PostConstruct;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Service
@DependsOn("entityManagerFactory")
public class FlowRegistry {
    public static final String FLOWS_KEY = "qrush:flows";
    private final StringRedisTemplate redis;
    private final DefaultRedisScript<Long> createScript;
    private final JdbcTemplate jdbc;
    public FlowRegistry(StringRedisTemplate redis, JdbcTemplate jdbc) { this.redis = redis; this.jdbc = jdbc; this.createScript=new DefaultRedisScript<>();this.createScript.setLocation(new ClassPathResource("scripts/create_flow.lua"));this.createScript.setResultType(Long.class); }

    @PostConstruct
    public void defaults() {
        create("hackathon", "Buildspace Hackathon", "slot", 100);
        create("product", "Studio Product Release", "item", 80);
        create("workshop", "Design Systems Workshop", "place", 60);
        // Opening details are durable; rebuild the fast registry after a cache restart.
        jdbc.query("SELECT * FROM openings", (rs, row) -> {
            projectOpening(rs.getString("id"), rs.getString("name"), rs.getString("description"),
                rs.getString("resource_prefix"), rs.getInt("capacity"),
                rs.getTimestamp("opens_at").toInstant(), rs.getTimestamp("created_at").toInstant());
            return rs.getString("id");
        });
    }

    public static void validateId(String id) {
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,80}")) throw new IllegalArgumentException("Use an identifier of 1–80 letters, numbers, underscores or hyphens.");
    }

    public synchronized FlowDefinition create(String id, String name, String prefix, int count) {
        validateId(id); validateId(prefix);
        if (count < 1 || count > 1000) throw new IllegalArgumentException("Resource count must be 1–1000.");
        String key = "flow:" + id;
        redis.execute(createScript,List.of(key,FLOWS_KEY),id,name,prefix,String.valueOf(count));
        FlowDefinition flow = get(id);
        if (!flow.resourcePrefix().equals(prefix) || flow.totalUnits() != count) {
            throw new IllegalArgumentException("This flow already exists with a different resource catalog. Create a new flow instead.");
        }
        return flow;
    }

    public FlowDefinition get(String id) {
        validateId(id);
        Map<Object,Object> fields = redis.opsForHash().entries("flow:" + id);
        if (fields.isEmpty()) throw new NoSuchElementException("Unknown flow: " + id);
        return new FlowDefinition(id, fields.get("name").toString(), fields.get("prefix").toString(), integer(fields,"totalUnits"),
            new FlowPolicy(integer(fields,"maxConcurrent"), integer(fields,"admissionRate"), integer(fields,"holdSeconds"), Boolean.parseBoolean(fields.get("adaptive").toString())),
            fields.getOrDefault("description", "").toString(), Instant.parse(fields.getOrDefault("opensAt", Instant.EPOCH.toString()).toString()),
            Instant.parse(fields.getOrDefault("createdAt", Instant.EPOCH.toString()).toString()), Boolean.parseBoolean(fields.getOrDefault("published", "false").toString()));
    }

    public FlowDefinition createOpening(String name, String description, int capacity, Instant opensAt, UUID requestId) {
        if (name == null || name.strip().length() < 3 || name.strip().length() > 100)
            throw new IllegalArgumentException("Give your opening a name between 3 and 100 characters.");
        if (description == null || description.strip().length() < 10 || description.strip().length() > 2000)
            throw new IllegalArgumentException("Describe your opening in 10 to 2,000 characters.");
        if (capacity < 1 || capacity > 1000) throw new IllegalArgumentException("Choose between 1 and 1,000 spots.");
        UUID key = requestId == null ? UUID.randomUUID() : requestId;
        var previous = storedOpening(key);
        if (!previous.isEmpty()) return restoreCreation(previous.getFirst(), name, description, capacity);
        if (opensAt == null || opensAt.isBefore(Instant.now().minusSeconds(60)))
            throw new IllegalArgumentException("Choose an opening time now or in the future.");
        String slug = name.strip().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        if (slug.isEmpty()) slug = "opening";
        String id = slug.substring(0, Math.min(40, slug.length())) + "-" + UUID.randomUUID().toString().substring(0, 12);
        Instant created = Instant.now();
        jdbc.update("INSERT INTO openings (id,name,description,resource_prefix,capacity,opens_at,created_at,request_id) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (request_id) DO NOTHING",
            id, name.strip(), description.strip(), "spot", capacity, Timestamp.from(opensAt), Timestamp.from(created), key);
        return restoreCreation(storedOpening(key).getFirst(), name, description, capacity);
    }

    private List<Map<String,Object>> storedOpening(UUID key) { return jdbc.queryForList("SELECT * FROM openings WHERE request_id = ?", key); }
    private FlowDefinition restoreCreation(Map<String,Object> row, String name, String description, int capacity) {
        if (!row.get("name").equals(name.strip()) || !row.get("description").equals(description.strip()) || ((Number)row.get("capacity")).intValue() != capacity)
            throw new IllegalArgumentException("This creation request already has different details. Start a new opening.");
        String id = row.get("id").toString();
        projectOpening(id, name.strip(), description.strip(), row.get("resource_prefix").toString(), capacity,
            ((Timestamp)row.get("opens_at")).toInstant(), ((Timestamp)row.get("created_at")).toInstant());
        return get(id);
    }

    private void projectOpening(String id, String name, String description, String prefix, int capacity, Instant opensAt, Instant created) {
        create(id, name, prefix, capacity);
        redis.opsForHash().putAll("flow:" + id, Map.of("name", name, "description", description,
            "opensAt", opensAt.toString(), "createdAt", created.toString(), "published", "true"));
    }

    public void requireOpen(String id) {
        if (!get(id).isOpen()) throw new ResponseStatusException(HttpStatus.CONFLICT, "Registration hasn't opened yet. Come back when the countdown ends.");
    }

    public List<FlowDefinition> all() {
        Set<String> ids = redis.opsForSet().members(FLOWS_KEY);
        return ids == null ? List.of() : ids.stream().sorted().map(this::get).toList();
    }

    public FlowDefinition updatePolicy(String id, FlowPolicy policy) {
        get(id);
        redis.opsForHash().putAll("flow:" + id, Map.of("maxConcurrent", String.valueOf(policy.maxConcurrent()), "admissionRate", String.valueOf(policy.admissionRate()), "holdSeconds", String.valueOf(policy.holdSeconds()), "adaptive", String.valueOf(policy.adaptive())));
        return get(id);
    }

    private int integer(Map<Object,Object> fields, String key) { return Integer.parseInt(fields.get(key).toString()); }
}
