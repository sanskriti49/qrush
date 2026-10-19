if redis.call('EXISTS',KEYS[1])==0 then
 redis.call('HSET',KEYS[1],'name',ARGV[2],'prefix',ARGV[3],'totalUnits',ARGV[4],'maxConcurrent','10','admissionRate','5','holdSeconds','300','adaptive','true')
end
redis.call('SADD',KEYS[2],ARGV[1])
return 1
