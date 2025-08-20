package main

import (
    "fmt"
    "net/http"
    "encoding/json"
    "log"
)

// User represents a user in the system
type User struct {
    ID       int    `json:"id"`
    Name     string `json:"name"`
    Email    string `json:"email"`
    IsActive bool   `json:"is_active"`
}

// UserService handles user operations
type UserService struct {
    users map[int]*User
}

// NewUserService creates a new user service
func NewUserService() *UserService {
    return &UserService{
        users: make(map[int]*User),
    }
}

// CreateUser adds a new user to the service
func (s *UserService) CreateUser(user *User) error {
    if _, exists := s.users[user.ID]; exists {
        return fmt.Errorf("user with ID %d already exists", user.ID)
    }
    s.users[user.ID] = user
    return nil
}

// GetUser retrieves a user by ID
func (s *UserService) GetUser(id int) (*User, error) {
    user, exists := s.users[id]
    if !exists {
        return nil, fmt.Errorf("user with ID %d not found", id)
    }
    return user, nil
}

// HandleUsers is an HTTP handler for user operations
func HandleUsers(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        handleGetUsers(w, r)
    case http.MethodPost:
        handleCreateUser(w, r)
    default:
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
    }
}

func handleGetUsers(w http.ResponseWriter, r *http.Request) {
    // Implementation for getting users
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func handleCreateUser(w http.ResponseWriter, r *http.Request) {
    var user User
    if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    
    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(user)
}

func main() {
    service := NewUserService()
    
    // Create test user
    testUser := &User{
        ID:       1,
        Name:     "John Doe",
        Email:    "john@example.com",
        IsActive: true,
    }
    
    if err := service.CreateUser(testUser); err != nil {
        log.Fatal(err)
    }
    
    http.HandleFunc("/users", HandleUsers)
    log.Println("Server starting on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}