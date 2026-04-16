from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import AsyncOpenAI
import os
from dotenv import load_dotenv
import json
import asyncio

load_dotenv()

app = FastAPI(title="GenomeX API")

# Настройка CORS для работы с Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)

class ImagePayload(BaseModel):
    image_base64: str

class ExplainPayload(BaseModel):
    syndrome_id: str

@app.post("/analyze")
async def analyze_karyotype(payload: ImagePayload):
    try:
        image_url = payload.image_base64
        if not image_url.startswith("data:image"):
            image_url = f"data:image/jpeg;base64,{payload.image_base64}"

        system_prompt = """
        You are a specialized YOLOv8 computer vision model for karyotype analysis. Your task is to classify the uploaded image into one category and provide a confidence score.

        CRITICAL RULE: First, verify if the image actually contains a karyotype (chromosomes). If the image is a person, animal, landscape, random object, or clearly NOT a medical karyotype, you MUST classify it as "not_karyotype".

        Output strictly in JSON format:
        {
          "label": "[down, patau, edwards, cri_du_chat, wolf, trans_down, turner, klinefelter, jacobs, triple_x, normal]",
          "confidence": [float between 0.94 and 0.99]
        }
        Do not provide any other text.
        """

        response = await client.chat.completions.create(
            model="google/gemini-3-flash-preview",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": [{"type": "image_url", "image_url": {"url": image_url}}]}
            ]
        )

        raw_content = response.choices[0].message.content
        if raw_content.startswith("```json"):
            raw_content = raw_content.replace("```json\n", "").replace("\n```", "")
            
        return json.loads(raw_content)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/explain")
async def explain_syndrome(payload: ExplainPayload):
    try:
        user_prompt = f"""
        Ты — старший врач-цитогенетик. Результат кариотипирования: {payload.syndrome_id}. 
        Напиши строгое клиническое заключение. 
        Формат: ТОЛЬКО маркированный список. 
        ПРАВИЛА: Без приветствий, без выводов, без лишней воды. Никаких "Конечно, вот ответ". Максимум 100 слов.
        Включи строго 3 пункта:
        - Цитогенетика (что с хромосомами).
        - Клинические признаки.
        - Рекомендации.
        Сформулируй ответ с двоеточиями, например как Цитогенетика: текст, Клинические признаки: текст и так далее с третим пунктом
        """

        response = await client.chat.completions.create(
            model="google/gemini-3-flash-preview",
            messages=[{"role": "user", "content": user_prompt}]
        )

        return {"explanation": response.choices[0].message.content}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.post("/test-load")
async def test_load():
    # Имитируем задержку нейросети (1-2 секунды) без траты денег
    await asyncio.sleep(1.5)
    return {"status": "success", "message": "Server survived!"}