-- Caller holds the pool's database lock and has verified no active allocation for this unit.
if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('DEL', KEYS[3]) end
if ARGV[3] ~= '1' then return 1 end
redis.call('SREM', KEYS[1], ARGV[1])
if redis.call('EXISTS', KEYS[4]) == 0 and redis.call('EXISTS', KEYS[5]) == 0 then
    redis.call('SADD', KEYS[2], ARGV[1])
end
return 1
