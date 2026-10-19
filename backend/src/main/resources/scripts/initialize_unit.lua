redis.call('SADD',KEYS[1],ARGV[1])
if redis.call('SISMEMBER',KEYS[2],ARGV[1])==0 and redis.call('EXISTS',KEYS[3])==0 and redis.call('EXISTS',KEYS[4])==0 then
 return redis.call('SADD',KEYS[5],ARGV[1])
end
return 0
