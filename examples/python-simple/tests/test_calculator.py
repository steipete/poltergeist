"""Unit tests for the calculator module."""

import sys
import os
import unittest

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from calculator import Calculator


class TestCalculator(unittest.TestCase):
    """Test cases for Calculator class."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.calc = Calculator()
    
    def test_add(self):
        """Test addition."""
        self.assertEqual(self.calc.add(2, 3), 5)
        self.assertEqual(self.calc.add(-1, 1), 0)
        self.assertEqual(self.calc.add(0.5, 0.5), 1.0)
    
    def test_subtract(self):
        """Test subtraction."""
        self.assertEqual(self.calc.subtract(5, 3), 2)
        self.assertEqual(self.calc.subtract(0, 5), -5)
        self.assertEqual(self.calc.subtract(1.5, 0.5), 1.0)
    
    def test_multiply(self):
        """Test multiplication."""
        self.assertEqual(self.calc.multiply(3, 4), 12)
        self.assertEqual(self.calc.multiply(-2, 3), -6)
        self.assertEqual(self.calc.multiply(0, 100), 0)
    
    def test_divide(self):
        """Test division."""
        self.assertEqual(self.calc.divide(10, 2), 5)
        self.assertEqual(self.calc.divide(7, 2), 3.5)
        self.assertEqual(self.calc.divide(-6, 3), -2)
    
    def test_divide_by_zero(self):
        """Test division by zero raises error."""
        with self.assertRaises(ValueError):
            self.calc.divide(5, 0)
    
    def test_power(self):
        """Test power operation."""
        self.assertEqual(self.calc.power(2, 3), 8)
        self.assertEqual(self.calc.power(5, 0), 1)
        self.assertEqual(self.calc.power(10, -1), 0.1)
    
    def test_factorial(self):
        """Test factorial."""
        self.assertEqual(self.calc.factorial(0), 1)
        self.assertEqual(self.calc.factorial(1), 1)
        self.assertEqual(self.calc.factorial(5), 120)
        self.assertEqual(self.calc.factorial(10), 3628800)
    
    def test_factorial_negative(self):
        """Test factorial with negative number raises error."""
        with self.assertRaises(ValueError):
            self.calc.factorial(-5)


if __name__ == '__main__':
    unittest.main()