import gkeepapi; keep = gkeepapi.Keep();
try:
    keep.resume('jare0014@gmail.com', 'google-keep-master-token')
    print('Token is VALID')
except Exception as e:
    print(f'Token is INVALID: {e}')
