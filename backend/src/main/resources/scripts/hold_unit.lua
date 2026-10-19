-- Atomic finite inventory + one hold per participant + enforced admission.
-- KEYS available, hold, confirmed, owner, admission token, active, catalog, leases, finalizing marker
local unit,user,ttl,token,now = ARGV[1],ARGV[2],tonumber(ARGV[3]),ARGV[4],tonumber(ARGV[5])
if redis.call('SISMEMBER',KEYS[7],unit)==0 then return -4 end
if redis.call('SISMEMBER',KEYS[3],unit)==1 then return 0 end
if redis.call('GET',KEYS[5])~=token then return -2 end
local active=redis.call('ZSCORE',KEYS[6],user)
if not active or tonumber(active)<=now then return -2 end
if redis.call('EXISTS',KEYS[9])==1 then return 0 end
local owner=redis.call('GET',KEYS[4])
local holder=redis.call('GET',KEYS[2])
if owner and owner~=unit then return -3 end
if holder==user then return 2 end
if holder then return 0 end
redis.call('SREM',KEYS[1],unit)
redis.call('SET',KEYS[2],user,'EX',ttl)
redis.call('SET',KEYS[4],unit,'EX',ttl)
redis.call('EXPIRE',KEYS[5],ttl)
redis.call('ZADD',KEYS[6],now+ttl*1000,user)
redis.call('ZADD',KEYS[8],now+ttl*1000,unit)
return 1
