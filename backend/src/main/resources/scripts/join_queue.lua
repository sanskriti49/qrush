-- Strict insertion sequence prevents timestamp ties from reordering FIFO users.
if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end
if redis.call('ZCARD', KEYS[1]) >= 10000 then return -1 end
local sequence = redis.call('INCR', KEYS[2])
redis.call('ZADD', KEYS[1], 'NX', sequence, ARGV[1])
return 1
