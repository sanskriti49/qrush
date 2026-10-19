-- Compare the fence so an old recovery cannot delete a newer participant's lease.
if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
redis.call('DEL',KEYS[1],KEYS[2],KEYS[3])
redis.call('ZREM',KEYS[4],ARGV[2])
if redis.call('SISMEMBER',KEYS[6],ARGV[2])==0 then redis.call('SADD',KEYS[5],ARGV[2]) end
redis.call('DEL',KEYS[7])
redis.call('ZREM',KEYS[8],ARGV[3])
redis.call('ZREM',KEYS[9],ARGV[3])
return 1
