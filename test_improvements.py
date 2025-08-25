#!/usr/bin/env python3
"""
Test script to demonstrate Primordyn improvements
"""

# Example decorator pattern that should now be indexed
@router.post("/messages")
async def send_message(request: Request, message: str = Form(...)):
    """Send a message endpoint"""
    return {"status": "sent", "message": message}

@router.get("/users/{user_id}")
async def get_user_profile(user_id: UUID) -> UserProfile:
    """Get user profile by ID"""
    user = await fetch_user(user_id)
    return user.profile

# Example with Depends pattern
async def get_current_user(token: str = Depends(oauth2_scheme)):
    """Get the current authenticated user"""
    return decode_token(token)

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Middleware to add processing time to headers"""
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response

class User:
    """User model class"""
    def __init__(self, name: str, email: str):
        self.name = name
        self.email = email
    
    async def get_profile(self) -> dict:
        """Get user profile data"""
        return {
            "name": self.name,
            "email": self.email
        }

# SQLAlchemy model example
class UserModel(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(120), unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)