-- One atomic read prevents advertising AVAILABLE during a concurrent settlement.
if redis.call('SISMEMBER',KEYS[1],ARGV[1])==1 then return {'CONFIRMED','0',''} end
local holder=redis.call('GET',KEYS[2])
if holder then return {'HELD',tostring(math.max(0,math.ceil(redis.call('PTTL',KEYS[2])/1000))),holder} end
if redis.call('SISMEMBER',KEYS[3],ARGV[1])==1 then return {'AVAILABLE','0',''} end
-- Unreconciled state is conservatively unavailable, never invented stock.
return {'HELD','0',''}
