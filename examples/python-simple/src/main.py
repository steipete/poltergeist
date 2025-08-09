#!/usr/bin/env python3
"""Main entry point for Python example."""

from calculator import Calculator
from statistics import Statistics


def main():
    """Demonstrate the calculator and statistics modules."""
    calc = Calculator()
    stats = Statistics()
    
    print("=== Calculator Demo ===")
    print(f"5 + 3 = {calc.add(5, 3)}")
    print(f"10 - 4 = {calc.subtract(10, 4)}")
    print(f"6 * 7 = {calc.multiply(6, 7)}")
    print(f"15 / 3 = {calc.divide(15, 3)}")
    print(f"2^8 = {calc.power(2, 8)}")
    print(f"5! = {calc.factorial(5)}")
    
    print("\n=== Statistics Demo ===")
    data = [2, 4, 6, 8, 10, 12, 14]
    print(f"Data: {data}")
    print(f"Mean: {stats.mean(data)}")
    print(f"Median: {stats.median(data)}")
    print(f"Variance: {stats.variance(data)}")
    print(f"Std Dev: {stats.std_dev(data):.2f}")
    print(f"Normalized: {[f'{x:.2f}' for x in stats.min_max_normalize(data)]}")
    
    # Write results to output file
    with open("output.txt", "w") as f:
        f.write(f"Calculator: 5 + 3 = {calc.add(5, 3)}\n")
        f.write(f"Statistics: Mean of {data} = {stats.mean(data)}\n")
    
    print("\nResults written to output.txt")


if __name__ == "__main__":
    main()