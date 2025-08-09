"""Unit tests for the statistics module."""

import sys
import os
import unittest

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from statistics import Statistics


class TestStatistics(unittest.TestCase):
    """Test cases for Statistics class."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.stats = Statistics()
    
    def test_mean(self):
        """Test mean calculation."""
        self.assertEqual(self.stats.mean([1, 2, 3, 4, 5]), 3)
        self.assertEqual(self.stats.mean([10]), 10)
        self.assertAlmostEqual(self.stats.mean([1.5, 2.5, 3.5]), 2.5)
    
    def test_mean_empty(self):
        """Test mean with empty list raises error."""
        with self.assertRaises(ValueError):
            self.stats.mean([])
    
    def test_median(self):
        """Test median calculation."""
        self.assertEqual(self.stats.median([1, 2, 3, 4, 5]), 3)
        self.assertEqual(self.stats.median([1, 2, 3, 4]), 2.5)
        self.assertEqual(self.stats.median([5, 1, 3, 2, 4]), 3)
        self.assertEqual(self.stats.median([10]), 10)
    
    def test_median_empty(self):
        """Test median with empty list raises error."""
        with self.assertRaises(ValueError):
            self.stats.median([])
    
    def test_variance(self):
        """Test variance calculation."""
        self.assertEqual(self.stats.variance([1, 1, 1, 1]), 0)
        self.assertEqual(self.stats.variance([1, 2, 3, 4, 5]), 2)
        self.assertAlmostEqual(self.stats.variance([2, 4, 6]), 2.666666666, places=5)
    
    def test_std_dev(self):
        """Test standard deviation calculation."""
        self.assertEqual(self.stats.std_dev([5, 5, 5]), 0)
        self.assertAlmostEqual(self.stats.std_dev([2, 4, 6, 8]), 2.236067977, places=5)
    
    def test_min_max_normalize(self):
        """Test min-max normalization."""
        result = self.stats.min_max_normalize([1, 2, 3, 4, 5])
        self.assertEqual(result, [0, 0.25, 0.5, 0.75, 1.0])
        
        result = self.stats.min_max_normalize([10, 20, 30])
        self.assertEqual(result, [0, 0.5, 1.0])
        
        # All same values
        result = self.stats.min_max_normalize([5, 5, 5])
        self.assertEqual(result, [0.5, 0.5, 0.5])
        
        # Empty list
        result = self.stats.min_max_normalize([])
        self.assertEqual(result, [])


if __name__ == '__main__':
    unittest.main()