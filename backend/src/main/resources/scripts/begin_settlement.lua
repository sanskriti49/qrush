-- Called only while holding the PostgreSQL advisory transaction lock for this pool.
if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('GET',KEYS[3])~=ARGV[3] then return 0 end
if redis.call('EXISTS',KEYS[2])==1 then return 0 end
redis.call('SET',KEYS[2],ARGV[2])
-- Persistent fenced hold prevents recycling during a slow DB transaction.
redis.call('PERSIST',KEYS[1])
redis.call('PERSIST',KEYS[4])
redis.call('ZREM',KEYS[5],ARGV[4])
redis.call('ZADD',KEYS[6],tonumber(ARGV[5])+30000,ARGV[4])
return 1
