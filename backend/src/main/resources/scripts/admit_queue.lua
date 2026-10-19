-- One atomic admission tick across any number of engine instances.
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local tick = math.floor(now / 1000)
if redis.call('GET', KEYS[3]) == tostring(tick) then return 0 end
redis.call('SET', KEYS[3], tostring(tick), 'EX', 3)
local capacity = math.max(0, tonumber(ARGV[2]) - redis.call('ZCARD', KEYS[2]))
local unreserved = 0
local active = redis.call('ZRANGE', KEYS[2], 0, -1)
for _,user in ipairs(active) do
 if redis.call('EXISTS',ARGV[8] .. user)==0 then unreserved=unreserved+1 end
end
local stockCapacity = math.max(0,redis.call('SCARD',KEYS[4])-unreserved)
local count = math.min(capacity, tonumber(ARGV[3]), stockCapacity)
if count <= 0 then return 0 end
local users = redis.call('ZPOPMIN', KEYS[1], count)
for i=1,#users,2 do
  local user = users[i]
  redis.call('SET', ARGV[4] .. user, ARGV[5] .. user, 'EX', ARGV[7])
  redis.call('ZADD', KEYS[2], now + tonumber(ARGV[7])*1000, user)
end
return #users/2
