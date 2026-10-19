-- Leave and release a user's reservation atomically against hold/confirm requests.
local user=ARGV[1]
local unit=redis.call('GET',KEYS[4])
local recycled=0
if unit then
 local holdKey=ARGV[2] .. 'hold:' .. unit
 local finalizingKey=ARGV[2] .. 'finalizing:' .. unit
 if redis.call('EXISTS',finalizingKey)==1 then return -1 end
 if redis.call('GET',holdKey)==user then
  redis.call('DEL',holdKey,KEYS[4])
  redis.call('ZREM',KEYS[7],unit)
  if redis.call('SISMEMBER',KEYS[6],unit)==0 then recycled=redis.call('SADD',KEYS[5],unit) end
 end
end
redis.call('DEL',KEYS[3])
redis.call('ZREM',KEYS[1],user)
redis.call('ZREM',KEYS[2],user)
return recycled
