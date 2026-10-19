-- Durable PostgreSQL allocation is the authority for this operation.
redis.call('SADD',KEYS[1],ARGV[1])
redis.call('SREM',KEYS[2],ARGV[1])
redis.call('DEL',KEYS[3],KEYS[4],KEYS[5],KEYS[8])
redis.call('ZREM',KEYS[6],ARGV[1])
redis.call('ZREM',KEYS[7],ARGV[1])
redis.call('ZREM',KEYS[9],ARGV[2])
redis.call('ZREM',KEYS[10],ARGV[2])
redis.call('SET',KEYS[11],ARGV[3])
return 1
