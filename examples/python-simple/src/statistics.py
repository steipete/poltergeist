"""Simple statistics module without external dependencies - Updated."""


class Statistics:
    """Basic statistics calculations without numpy or scipy."""
    
    def mean(self, data: list) -> float:
        """Calculate the mean of a list of numbers."""
        if not data:
            raise ValueError("Cannot calculate mean of empty list")
        return sum(data) / len(data)
    
    def median(self, data: list) -> float:
        """Calculate the median of a list of numbers."""
        if not data:
            raise ValueError("Cannot calculate median of empty list")
        sorted_data = sorted(data)
        n = len(sorted_data)
        if n % 2 == 0:
            return (sorted_data[n//2 - 1] + sorted_data[n//2]) / 2
        return sorted_data[n//2]
    
    def variance(self, data: list) -> float:
        """Calculate the variance of a list of numbers."""
        if not data:
            raise ValueError("Cannot calculate variance of empty list")
        avg = self.mean(data)
        return sum((x - avg) ** 2 for x in data) / len(data)
    
    def std_dev(self, data: list) -> float:
        """Calculate the standard deviation of a list of numbers."""
        return self.variance(data) ** 0.5
    
    def min_max_normalize(self, data: list) -> list:
        """Normalize data to range [0, 1]."""
        if not data:
            return []
        min_val = min(data)
        max_val = max(data)
        if max_val == min_val:
            return [0.5] * len(data)
        return [(x - min_val) / (max_val - min_val) for x in data]