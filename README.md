# JamPad - Music Collaboration Platform

JamPad is a web-based music collaboration platform that allows musicians to record, share, and collaborate on music projects. The platform features real-time audio recording, user matching based on musical preferences, and AI-powered recommendations.

## Features

- **Audio Recording**: Record music tracks directly in the browser
- **User Matching**: Find collaborators based on instrument preferences and genres
- **AI Integration**: Google Generative AI and OpenAI integration for enhanced features
- **User Authentication**: Secure login and registration system
- **Profile Management**: User profiles with musical preferences
- **Real-time Collaboration**: Overdub and layering capabilities
- **Search & Discovery**: Advanced search with RAG (Retrieval-Augmented Generation)

## Tech Stack

### Backend
- **Node.js** with Express.js for the main server
- **Python** with FastAPI for AI/ML services
- **SQLite** for database management
- **Multer** for file upload handling
- **bcryptjs** for password hashing
- **Express-session** for session management

### Frontend
- **HTML5** with modern CSS
- **JavaScript** for client-side functionality
- **Web Audio API** for audio recording and playback

### AI/ML
- **Google Generative AI** for intelligent features
- **OpenAI API** for advanced AI capabilities
- **RAG (Retrieval-Augmented Generation)** for smart recommendations

## Prerequisites

- Node.js (v14 or higher)
- Python (v3.8 or higher)
- npm or yarn package manager

## Installation

### 1. Clone the repository
```bash
git clone <repository-url>
cd JamPad
```

### 2. Install Node.js dependencies
```bash
npm install
```

### 3. Install Python dependencies
```bash
pip install -r requirements.txt
```

### 4. Environment Setup
Create a `.env` file in the root directory with the following variables:
```env
OPENAI_API_KEY=your_openai_api_key_here
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
SESSION_SECRET=your_session_secret_here
```

## Running the Application

### Start the Node.js server
```bash
npm start
```
The main application will be available at `http://localhost:3000`

### Start the FastAPI server (optional)
```bash
python fast_api_server.py
```
The FastAPI server will be available at `http://localhost:8000`

## Project Structure

```
JamPad/
├── server.js              # Main Node.js server
├── fast_api_server.py     # Python FastAPI server
├── package.json           # Node.js dependencies
├── requirements.txt       # Python dependencies
├── jampad.db             # SQLite database
├── recordings/            # Audio recordings directory
├── letsjam.html          # Main collaboration interface
├── studio.html           # Music studio interface
├── user-studio.html      # User studio interface
├── login.html            # Login page
├── profile.html          # User profile page
├── page1.html            # Landing page
├── page2.html            # Additional pages
├── styles.css            # Global styles
└── test-gemini.js        # AI testing utilities
```

## API Endpoints

### Node.js Server (Port 3000)
- `POST /register` - User registration
- `POST /login` - User authentication
- `POST /upload` - Audio file upload
- `GET /recordings/:filename` - Serve audio files
- `GET /profile` - Get user profile
- `POST /profile` - Update user profile

### FastAPI Server (Port 8000)
- `GET /search` - Search users by instrument/genre
- `POST /rag-search` - AI-powered user search with audio analysis

## Database Schema

### Users Table
- `id` (PRIMARY KEY)
- `username` (UNIQUE)
- `password` (hashed)
- `email` (UNIQUE)
- `created_at`

### Jams Table
- `id` (PRIMARY KEY)
- `user_id` (FOREIGN KEY)
- `title`
- `filename`
- `instrument`
- `original_jam_id`
- `original_instrument`
- `status`
- `created_at`

### Friendships Table
- `id` (PRIMARY KEY)
- `user_id` (FOREIGN KEY)
- `friend_id` (FOREIGN KEY)
- `status`

## Usage

1. **Registration/Login**: Create an account or log in to access the platform
2. **Profile Setup**: Add your preferred instruments and genres
3. **Recording**: Use the studio interface to record your music
4. **Collaboration**: Find other musicians and collaborate on projects
5. **Sharing**: Share your recordings and get feedback

## Development

### Running in Development Mode
```bash
npm run dev
```

### Testing AI Features
```bash
node test-gemini.js
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## Support

For support and questions, please open an issue in the repository or contact the development team.

## Acknowledgments

- Web Audio API for audio processing capabilities
- Google Generative AI for intelligent features
- OpenAI for advanced AI integration
- Express.js community for the robust web framework

