require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI("AIzaSyD4MvYXxOSdPte6oxVyKhlFVOKCoj1QA5Q");

async function test() {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("Say hello!");
    const response = await result.response;
    console.log("Gemini API response:", response.text());
  } catch (e) {
    console.error("Gemini API error:", e);
  }
}

test(); 