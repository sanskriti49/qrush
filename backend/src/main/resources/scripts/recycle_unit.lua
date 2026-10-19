-- Recheck all state atomically; a concurrent hold or settlement always wins.
if redis.call('EXISTS',KEYS[2])==1 or redis.call('EXISTS',KEYS[4])==1 then return 0 end
redis.call('ZREM',KEYS[5],ARGV[1])
if redis.call('SISMEMBER',KEYS[3],ARGV[1])==1 or redis.call('SISMEMBER',KEYS[6],ARGV[1])==0 then return 0 end
return redis.call('SADD',KEYS[1],ARGV[1])
