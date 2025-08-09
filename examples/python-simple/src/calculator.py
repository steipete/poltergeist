"""Simple calculator module for Poltergeist Python example."""


class Calculator:
    """A simple calculator with basic operations."""
    
    def add(self, a: float, b: float) -> float:
        """Add two numbers."""
        return a + b
    
    def subtract(self, a: float, b: float) -> float:
        """Subtract b from a."""
        return a - b
    
    def multiply(self, a: float, b: float) -> float:
        """Multiply two numbers."""
        return a * b
    
    def divide(self, a: float, b: float) -> float:
        """Divide a by b."""
        if b == 0:
            raise ValueError("Division by zero is not allowed")
        return a / b
    
    def power(self, base: float, exponent: float) -> float:
        """Raise base to the power of exponent."""
        return base ** exponent
    
    def factorial(self, n: int) -> int:
        """Calculate factorial of n."""
        if n < 0:
            raise ValueError("Factorial is not defined for negative numbers")
        if n == 0 or n == 1:
            return 1
        result = 1
        for i in range(2, n + 1):
            result *= i
        return result