cmake_minimum_required(VERSION 3.10)
project(MathLib VERSION 1.0.0 LANGUAGES C)

# Create the library
add_library(mathlib STATIC
    src/math_ops.c
)

# Set include directories
target_include_directories(mathlib PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

# Create test executable
add_executable(test_mathlib test/test_math.c)
target_link_libraries(test_mathlib mathlib)

# Enable testing
enable_testing()
add_test(NAME MathLibTest COMMAND test_mathlib)