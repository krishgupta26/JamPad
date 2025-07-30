from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
from typing import List, Optional
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/search")
async def search_users(
    instrument: str = None,
    genre: str = None,
    min_jams: int = None
):
    conn = sqlite3.connect('jampad.db')
    cursor = conn.cursor()
    
    query = "SELECT username, preferred_instruments, preferred_genres, jam_count FROM users WHERE 1=1"
    params = []

    if instrument:
        query += " AND preferred_instruments LIKE ?"
        params.append(f"%{instrument}%")
    if genre:
        query += " AND preferred_genres LIKE ?"
        params.append(f"%{genre}%")
    if min_jams:
        query += " AND jam_count >= ?"
        params.append(min_jams)

    cursor.execute(query, params)
    results = cursor.fetchall()
    conn.close()

    return [{"username": row[0], "instruments": row[1], "genres": row[2], "jam_count": row[3]} for row in results]

from fastapi import FastAPI, UploadFile, Form
from typing import List, Optional
import sqlite3
from pydantic import BaseModel

# Add these new endpoints
@app.post("/rag-search")
async def rag_search(
    audio: UploadFile,
    description: str = Form(...),
    genre: Optional[str] = Form(None),
    instrument: Optional[str] = Form(None)
):
    # Here you would:
    # 1. Process the audio file to extract features (tempo, key, etc.)
    # 2. Analyze the description using NLP
    # 3. Query the database for matching users
    # 4. Use RAG to provide contextual recommendations
    
    conn = sqlite3.connect('jampad.db')
    cursor = conn.cursor()
    
    # Example query using RAG context
    query = """
        SELECT 
            u.username,
            u.preferred_instruments,
            u.preferred_genres,
            u.jam_count
        FROM users u
        WHERE 1=1
    """
    params = []
    
    if instrument:
        query += " AND u.preferred_instruments LIKE ?"
        params.append(f"%{instrument}%")
    
    if genre:
        query += " AND u.preferred_genres LIKE ?"
        params.append(f"%{genre}%")
    
    cursor.execute(query, params)
    results = cursor.fetchall()
    conn.close()
    
    # Process results with RAG context
    recommendations = []
    for row in results:
        recommendation = {
            "username": row[0],
            "instruments": row[1].split(',') if row[1] else [],
            "genres": row[2].split(',') if row[2] else [],
            "jam_count": row[3],
            "recommendation_reason": generate_rag_recommendation(
                description,
                row[1],
                row[2],
                row[3]
            )
        }
        recommendations.append(recommendation)
    
    return recommendations

def generate_rag_recommendation(description: str, instruments: str, genres: str, jam_count: int) -> str:
    # This is where you'd implement your RAG logic
    # For now, returning a simple recommendation
    return f"Based on their experience with {instruments} and expertise in {genres} genres. They have completed {jam_count} jams."