-- A settling lease cannot be released while its database transaction is in flight.
if redis.call('GET',KEYS[7])~=ARGV[3] then return 0 end
if redis.call('EXISTS',KEYS[6])==1 then return 0 end
if redis.call('GET',KEYS[2])~=ARGV[2] then return 0 end
redis.call('DEL',KEYS[2],KEYS[4])
redis.call('ZREM',KEYS[5],ARGV[1])
if redis.call('SISMEMBER',KEYS[3],ARGV[1])==0 then redis.call('SADD',KEYS[1],ARGV[1]) end
redis.call('DEL',KEYS[7])
redis.call('ZREM',KEYS[8],ARGV[2])
redis.call('ZREM',KEYS[9],ARGV[2])
return 1
