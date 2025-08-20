use std::collections::HashMap;
use std::error::Error;

/// Represents a configuration for the application
#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub max_connections: usize,
}

impl Config {
    /// Creates a new configuration with default values
    pub fn new() -> Self {
        Config {
            host: "localhost".to_string(),
            port: 8080,
            database_url: "postgres://localhost/mydb".to_string(),
            max_connections: 10,
        }
    }
    
    /// Creates a configuration from environment variables
    pub fn from_env() -> Result<Self, Box<dyn Error>> {
        let host = std::env::var("HOST").unwrap_or_else(|_| "localhost".to_string());
        let port = std::env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse()?;
        let database_url = std::env::var("DATABASE_URL")?;
        let max_connections = std::env::var("MAX_CONNECTIONS")
            .unwrap_or_else(|_| "10".to_string())
            .parse()?;
        
        Ok(Config {
            host,
            port,
            database_url,
            max_connections,
        })
    }
}

/// A simple cache implementation using HashMap
pub struct Cache<T> {
    data: HashMap<String, T>,
    capacity: usize,
}

impl<T: Clone> Cache<T> {
    /// Creates a new cache with specified capacity
    pub fn new(capacity: usize) -> Self {
        Cache {
            data: HashMap::new(),
            capacity,
        }
    }
    
    /// Inserts a value into the cache
    pub fn insert(&mut self, key: String, value: T) -> Option<T> {
        if self.data.len() >= self.capacity && !self.data.contains_key(&key) {
            // Simple eviction: remove first item
            if let Some(first_key) = self.data.keys().next().cloned() {
                self.data.remove(&first_key);
            }
        }
        self.data.insert(key, value)
    }
    
    /// Gets a value from the cache
    pub fn get(&self, key: &str) -> Option<&T> {
        self.data.get(key)
    }
    
    /// Clears the cache
    pub fn clear(&mut self) {
        self.data.clear();
    }
}

/// Trait for processing data
pub trait DataProcessor {
    fn process(&self, input: &str) -> String;
    fn validate(&self, input: &str) -> bool;
}

/// A simple string processor
struct StringProcessor {
    prefix: String,
}

impl StringProcessor {
    fn new(prefix: String) -> Self {
        StringProcessor { prefix }
    }
}

impl DataProcessor for StringProcessor {
    fn process(&self, input: &str) -> String {
        format!("{}{}", self.prefix, input)
    }
    
    fn validate(&self, input: &str) -> bool {
        !input.is_empty()
    }
}

/// Module for utilities
mod utils {
    /// Converts a string to uppercase
    pub fn to_uppercase(s: &str) -> String {
        s.to_uppercase()
    }
    
    /// Checks if a string is a palindrome
    pub fn is_palindrome(s: &str) -> bool {
        let cleaned: String = s.chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>()
            .to_lowercase();
        let reversed: String = cleaned.chars().rev().collect();
        cleaned == reversed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_config_new() {
        let config = Config::new();
        assert_eq!(config.port, 8080);
    }
    
    #[test]
    fn test_cache() {
        let mut cache = Cache::new(2);
        cache.insert("key1".to_string(), "value1");
        assert_eq!(cache.get("key1"), Some(&"value1"));
    }
}