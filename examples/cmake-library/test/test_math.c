#include <stdio.h>
#include "math_ops.h"

int main() {
    printf("Testing MathLib (built with Poltergeist)\n");
    
    // Test add
    int sum = add(5, 3);
    printf("add(5, 3) = %d\n", sum);
    
    // Test multiply
    int product = multiply(4, 7);
    printf("multiply(4, 7) = %d\n", product);
    
    // Test divide_safe
    double result = divide_safe(10.0, 2.0);
    printf("divide_safe(10.0, 2.0) = %.2f\n", result);
    
    // Test divide by zero
    double safe = divide_safe(5.0, 0.0);
    printf("divide_safe(5.0, 0.0) = %.2f (safe!)\n", safe);
    
    return 0;
}