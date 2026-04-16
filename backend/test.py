import asyncio
import aiohttp
import time

URL = "https://genomex-medical-project-production.up.railway.app/test-load"
REQUESTS_COUNT = 200 # Количество одновременных пользователей

async def fetch(session):
    async with session.post(URL) as response:
        return response.status

async def main():
    start_time = time.time()
    
    # Открываем одну сессию для всех юзеров
    async with aiohttp.ClientSession() as session:
        # Создаем массив задач (как будто 200 человек кликнули одновременно)
        tasks = [fetch(session) for _ in range(REQUESTS_COUNT)]
        results = await asyncio.gather(*tasks)
    
    end_time = time.time()
    
    # Считаем результаты
    success = results.count(200)
    errors = len(results) - success
    
    print(f"🔥 Тест завершен за {round(end_time - start_time, 2)} секунд")
    print(f"✅ Успешно: {success}")
    print(f"❌ Ошибок: {errors}")

if __name__ == "__main__":
    asyncio.run(main())